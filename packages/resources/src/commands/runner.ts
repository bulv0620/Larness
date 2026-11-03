import { execFile, spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import { OutputRedactor } from "./redactor.js";

const exec = promisify(execFile);
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
export interface CommandOutputChunk {
  channel: "stdout" | "stderr";
  data: string;
  timestamp: number;
}
export interface CommandRunOptions {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  secrets?: string[];
  signal?: AbortSignal;
  onSpawn?: (pid: number) => void;
  onOutput?: (chunk: CommandOutputChunk) => void;
  stopGraceMs?: number;
}
export interface CommandRunResult {
  exitCode: number | null;
  reasonCode: string | null;
  truncated: boolean;
  stopped: boolean;
}
export function commandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "TERM",
  ]) {
    if (source[key] !== undefined) env[key] = source[key];
  }
  return env;
}
interface GroupMember {
  pid: number;
  birth: string;
}
async function groupMembers(pgid: number): Promise<GroupMember[]> {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,pgid=,stat=,lstart=,comm="], {
    timeout: 2000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...commandEnvironment(), LC_ALL: "C" },
  });
  const members: GroupMember[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(line);
    if (match && Number(match[2]) === pgid && !match[3].startsWith("Z")) {
      members.push({ pid: Number(match[1]), birth: match[4] });
    }
  }
  return members;
}
export async function groupAlive(pid: number): Promise<boolean> {
  return (await groupMembers(pid)).length > 0;
}
function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
      throw new Error("Process stop failed");
  }
}
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function stopCommandGroup(
  pid: number,
  graceMs = 300,
  authorizeSignal?: (members: GroupMember[]) => Promise<boolean>,
): Promise<boolean> {
  try {
    const initial = await groupMembers(pid);
    if (!initial.length) return true;
    if (!(await authorizeSignal?.(initial))) return false;
    signalGroup(pid, "SIGTERM");
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline) {
      if (!(await groupAlive(pid))) return true;
      await delay(20);
    }
    const remaining = await groupMembers(pid);
    if (!remaining.length) return true;
    if (!(await authorizeSignal?.(remaining))) return false;
    signalGroup(pid, "SIGKILL");
    const hardDeadline = Date.now() + 2000;
    while (Date.now() < hardDeadline) {
      if (!(await groupAlive(pid))) return true;
      await delay(20);
    }
    return false;
  } catch {
    return false;
  }
}
export async function runCommand(options: CommandRunOptions): Promise<CommandRunResult> {
  if (process.platform === "win32")
    throw new Error("Command execution unavailable on this platform");
  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 600_000)
    throw new Error("Invalid command timeout");
  if (options.signal?.aborted)
    return { exitCode: null, reasonCode: "CANCELLED", truncated: false, stopped: true };
  const streams = {
    stdout: {
      decoder: new StringDecoder("utf8"),
      redact: new OutputRedactor(options.secrets ?? []),
    },
    stderr: {
      decoder: new StringDecoder("utf8"),
      redact: new OutputRedactor(options.secrets ?? []),
    },
  };
  let reason: string | null = null,
    truncated = false,
    used = 0;
  let stop: Promise<boolean> | undefined;
  let exitCode: number | null = null;
  let finishStop: (() => void) | undefined;
  const stopFinished = new Promise<void>((resolve) => {
    finishStop = resolve;
  });
  const owned = new Map<number, string>();
  let birthCapture: Promise<void> = Promise.resolve();
  const authorizeSignal = async () => {
    await birthCapture;
    if (!child.pid) return false;
    const members = await groupMembers(child.pid);
    if (!members.some((member) => owned.get(member.pid) === member.birth)) return false;
    // Only a still-live original leader can establish ownership of new members.
    // After it exits, signals require a member captured while that leader lived.
    if (
      child.exitCode === null &&
      child.signalCode === null &&
      members.some((member) => member.pid === child.pid && owned.get(member.pid) === member.birth)
    ) {
      for (const member of members) owned.set(member.pid, member.birth);
    }
    return true;
  };
  const startStop = () => {
    if (!child.pid || stop) return;
    stop = stopCommandGroup(child.pid, options.stopGraceMs, authorizeSignal);
    void stop.then(() => {
      setTimeout(() => finishStop?.(), 200);
    });
  };
  const child = spawn(options.executable, options.args, {
    cwd: options.cwd,
    env: commandEnvironment(options.env),
    shell: false,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const requestStop = (code: string) => {
    reason ??= code;
    startStop();
  };
  const emit = (channel: "stdout" | "stderr", text: string) => {
    let bytes = Buffer.from(text);
    while (bytes.length) {
      const room = MAX_COMMAND_OUTPUT_BYTES - used;
      if (room <= 0) {
        truncated = true;
        return;
      }
      let length = Math.min(bytes.length, 16 * 1024, room);
      while (length > 0 && length < bytes.length && (bytes[length] & 0xc0) === 0x80) length--;
      if (!length) {
        truncated = true;
        return;
      }
      used += length;
      try {
        options.onOutput?.({
          channel,
          data: bytes.subarray(0, length).toString("utf8"),
          timestamp: Date.now(),
        });
      } catch {
        truncated = true;
        requestStop("OUTPUT_FAILED");
      }
      bytes = bytes.subarray(length);
    }
  };
  for (const channel of ["stdout", "stderr"] as const) {
    child[channel].on("data", (bytes: Buffer) => {
      const stream = streams[channel];
      emit(channel, stream.redact.push(stream.decoder.write(bytes)));
    });
  }
  const abort = () => requestStop("CANCELLED");
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const timeout = setTimeout(() => requestStop("TIMED_OUT"), options.timeoutMs);
  const closed = new Promise<void>((resolve) => {
    child.once("close", (code) => {
      exitCode = code;
      resolve();
    });
  });
  child.once("error", () => {
    reason ??= "SPAWN_FAILED";
  });
  child.once("spawn", () => {
    if (child.pid) {
      birthCapture = groupMembers(child.pid)
        .then((members) => {
          if (child.exitCode === null && child.signalCode === null) {
            for (const member of members) owned.set(member.pid, member.birth);
          }
        })
        .catch(() => {});
    }
    try {
      if (child.pid) options.onSpawn?.(child.pid);
    } catch {
      requestStop("START_RECORD_FAILED");
    }
  });
  // A leader can exit while descendants keep its pipes open. Stop the group on
  // leader exit rather than waiting indefinitely for the stream close event.
  child.once("exit", () => {
    startStop();
  });
  const pipesClosed = await Promise.race([closed.then(() => true), stopFinished.then(() => false)]);
  if (!pipesClosed) {
    truncated = true;
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  clearTimeout(timeout);
  options.signal?.removeEventListener("abort", abort);
  const stopped =
    pipesClosed &&
    (child.pid
      ? await (stop ?? stopCommandGroup(child.pid, options.stopGraceMs, authorizeSignal))
      : true);
  for (const channel of ["stdout", "stderr"] as const) {
    const stream = streams[channel];
    emit(channel, stream.redact.push(stream.decoder.end(), true));
  }
  return {
    exitCode,
    reasonCode: !stopped
      ? "STOP_UNCONFIRMED"
      : (reason ?? (exitCode === 0 ? null : "NONZERO_EXIT")),
    truncated,
    stopped,
  };
}
