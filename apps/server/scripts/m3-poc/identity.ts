import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  session: number;
  birth: string;
}

export interface ListenerInfo {
  pid: number;
  command: string;
  address: string;
  port: number;
  wildcard: boolean;
  loopback: boolean;
}

export interface ExecutionBinding {
  terminalId: string;
  executionId: string;
  leaderPid: number;
  leaderBirth: string;
  session: number;
  pid: number;
  birth: string;
  address: string;
  port: number;
  generation: number;
}

export interface BindInput {
  terminalId: string;
  leaderPid: number;
  port: number;
  generation: number;
}

export class IdentityError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "IdentityError";
  }
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await exec(command, args, {
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

function exitedWithoutMatches(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 1
  );
}

export async function processSnapshot(): Promise<ProcessInfo[]> {
  const stdout = await run("ps", ["-axo", "pid=,ppid=,pgid=,sess=,stat=,lstart="]);
  const processes: ProcessInfo[] = [];
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[4]?.startsWith("Z")) continue;
    processes.push({
      pid: Number(fields[0]),
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      session: Number(fields[3]),
      birth: fields.slice(5).join(" "),
    });
  }
  return processes;
}

function parseAddress(
  value: string,
): { address: string; port: number; wildcard: boolean; loopback: boolean } | undefined {
  const separator = value.lastIndexOf(":");
  if (separator < 0) return undefined;
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0) return undefined;
  let host = value.slice(0, separator);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  return {
    address: value,
    port,
    wildcard: host === "*" || host === "0.0.0.0" || host === "::",
    loopback: host === "127.0.0.1" || host === "::1",
  };
}

export async function listeningSockets(port: number): Promise<ListenerInfo[]> {
  let stdout: string;
  try {
    stdout = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpcn"]);
  } catch (error) {
    if (exitedWithoutMatches(error)) return [];
    throw error;
  }
  const sockets: ListenerInfo[] = [];
  let pid = 0;
  let command = "";
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const value = line.slice(1);
    if (line[0] === "p") {
      pid = Number(value);
      command = "";
    } else if (line[0] === "c") {
      command = value;
    } else if (line[0] === "n") {
      const parsed = parseAddress(value);
      if (parsed) sockets.push({ pid, command, ...parsed });
    }
  }
  return sockets;
}

export function descendsFrom(processes: ProcessInfo[], pid: number, ancestorPid: number): boolean {
  const byPid = new Map(processes.map((item) => [item.pid, item]));
  const seen = new Set<number>();
  let current = byPid.get(pid);
  while (current && !seen.has(current.pid)) {
    if (current.pid === ancestorPid) return true;
    seen.add(current.pid);
    current = byPid.get(current.ppid);
  }
  return false;
}

export async function bindExecution(input: BindInput): Promise<ExecutionBinding> {
  const processes = await processSnapshot();
  const leader = processes.find((item) => item.pid === input.leaderPid);
  if (!leader) throw new IdentityError("TERMINAL_NOT_RUNNING");
  const sockets = await listeningSockets(input.port);
  if (sockets.length === 0) throw new IdentityError("LISTENER_NOT_FOUND");
  const pids = new Set(sockets.map((item) => item.pid));
  if (pids.size > 1) throw new IdentityError("LISTENER_OWNER_AMBIGUOUS");
  const socket = sockets[0];
  if (sockets.some((item) => item.wildcard || !item.loopback)) {
    throw new IdentityError("LISTENER_NOT_LOOPBACK");
  }
  const owner = processes.find((item) => item.pid === socket.pid);
  if (!owner) throw new IdentityError("LISTENER_OWNER_UNKNOWN");
  if (!descendsFrom(processes, owner.pid, leader.pid)) {
    throw new IdentityError("LISTENER_NOT_IN_TERMINAL_TREE");
  }
  return {
    terminalId: input.terminalId,
    executionId: `exe_${randomUUID()}`,
    leaderPid: leader.pid,
    leaderBirth: leader.birth,
    session: leader.session,
    pid: owner.pid,
    birth: owner.birth,
    address: socket.address,
    port: socket.port,
    generation: input.generation,
  };
}

export async function verifyExecution(binding: ExecutionBinding): Promise<void> {
  const processes = await processSnapshot();
  const leader = processes.find((item) => item.pid === binding.leaderPid);
  if (!leader || leader.birth !== binding.leaderBirth) {
    throw new IdentityError("TERMINAL_IDENTITY_CHANGED");
  }
  if (binding.session !== 0 && leader.session !== binding.session) {
    throw new IdentityError("TERMINAL_SESSION_CHANGED");
  }
  const sockets = await listeningSockets(binding.port);
  if (sockets.length === 0) throw new IdentityError("LISTENER_GONE");
  const socket = sockets.find((item) => item.pid === binding.pid);
  if (!socket) throw new IdentityError("LISTENER_REPLACED");
  const owner = processes.find((item) => item.pid === socket.pid);
  if (!owner || owner.birth !== binding.birth) {
    throw new IdentityError("LISTENER_IDENTITY_CHANGED");
  }
  if (!descendsFrom(processes, owner.pid, binding.leaderPid)) {
    throw new IdentityError("LISTENER_NOT_IN_TERMINAL_TREE");
  }
  if (socket.address !== binding.address) throw new IdentityError("LISTENER_ADDRESS_CHANGED");
  if (socket.wildcard || !socket.loopback) throw new IdentityError("LISTENER_NOT_LOOPBACK");
}
