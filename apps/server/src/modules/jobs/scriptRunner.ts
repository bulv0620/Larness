import { spawn } from "node:child_process";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { OutputRedactor } from "@larness/resources";
import type { ScheduledJobRunErrorCode, ScheduledJobRunStatus } from "@larness/shared";

const MAX_OUTPUT_CHARS = 64 * 1024;
const KILL_GRACE_MS = 5_000;

export interface ScriptRunInput {
  dataDir: string;
  jobId: string;
  runId: string;
  source: string;
  cwd: string;
  timezone: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface ScriptRunResult {
  status: Extract<ScheduledJobRunStatus, "succeeded" | "failed" | "timed_out" | "cancelled">;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  errorCode: ScheduledJobRunErrorCode | null;
  errorMessage: string | null;
}

function scriptEnvironment(input: ScriptRunInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    TZ: input.timezone,
    LARNESS_JOB_ID: input.jobId,
    LARNESS_JOB_RUN_ID: input.runId,
  };

  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return env;
}

function killTree(pid: number | undefined, detached: boolean, signal: NodeJS.Signals): void {
  if (pid === undefined) {
    return;
  }

  try {
    if (detached) {
      process.kill(-pid, signal);
      return;
    }
  } catch {
    // Fall through to a direct child signal.
  }

  try {
    process.kill(pid, signal);
  } catch {
    // The process already exited.
  }
}

export async function runScript(input: ScriptRunInput): Promise<ScriptRunResult> {
  const directory = path.join(input.dataDir, "jobs", "runs");
  const file = path.join(directory, `${input.runId}.mjs`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(file, input.source, { mode: 0o600 });

  if (input.signal.aborted) {
    await unlink(file).catch(() => undefined);
    return {
      status: "cancelled",
      exitCode: null,
      output: "",
      truncated: false,
      errorCode: "JOB_RUN_CANCELLED",
      errorMessage: "运行已取消",
    };
  }

  const detached = process.platform !== "win32";
  let output = "";
  let truncated = false;
  let reason: "timeout" | "cancel" | null = null;
  let settled = false;

  return new Promise<ScriptRunResult>((resolve) => {
    const child = spawn(process.execPath, [file], {
      cwd: input.cwd,
      env: scriptEnvironment(input),
      shell: false,
      detached,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;

    const terminate = (nextReason: "timeout" | "cancel") => {
      if (reason === null) {
        reason = nextReason;
      }
      killTree(child.pid, detached, "SIGTERM");
      if (killTimer === undefined) {
        killTimer = setTimeout(() => killTree(child.pid, detached, "SIGKILL"), KILL_GRACE_MS);
        killTimer.unref?.();
      }
    };

    const append = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (output.length > MAX_OUTPUT_CHARS) {
        output = output.slice(-MAX_OUTPUT_CHARS);
        truncated = true;
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);

    const onAbort = () => terminate("cancel");
    input.signal.addEventListener("abort", onAbort, { once: true });

    timeoutTimer = setTimeout(() => terminate("timeout"), input.timeoutMs);
    timeoutTimer.unref?.();

    const finish = (exitCode: number | null, errorMessage: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.signal.removeEventListener("abort", onAbort);
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      void unlink(file).catch(() => undefined);

      const redacted = new OutputRedactor([]).push(output, true);
      const status =
        reason === "timeout"
          ? "timed_out"
          : reason === "cancel"
            ? "cancelled"
            : exitCode === 0
              ? "succeeded"
              : "failed";

      resolve({
        status,
        exitCode,
        output: redacted,
        truncated,
        errorCode:
          status === "timed_out"
            ? "JOB_TIMEOUT"
            : status === "cancelled"
              ? "JOB_RUN_CANCELLED"
              : status === "failed"
                ? "JOB_SCRIPT_FAILED"
                : null,
        errorMessage:
          status === "timed_out"
            ? "脚本执行超时"
            : status === "cancelled"
              ? "运行已取消"
              : status === "failed"
                ? (errorMessage ?? `脚本以退出码 ${exitCode ?? "未知"} 结束`)
                : null,
      });
    };

    child.once("error", () => finish(null, "无法启动脚本进程"));
    child.once("close", (code, signal) => {
      finish(code, signal === null ? null : `脚本被信号 ${signal} 终止`);
    });
  });
}
