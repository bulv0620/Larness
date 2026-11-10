import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  commandEnvironment,
  processSnapshot as platformProcessSnapshot,
  windowsTcpListeners,
} from "@larness/resources";

const exec = promisify(execFile);

export interface ExecutionIdentity {
  leaderPid: number;
  leaderBirth: string;
  session: number;
  pid: number;
  birth: string;
  address: string;
  dialHost: string;
  port: number;
}

export class ServiceIdentityError extends Error {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceIdentityError";
  }
}

interface ProcessInfo {
  pid: number;
  ppid: number;
  pgid: number;
  session: number;
  birth: string;
}

interface ListenerInfo {
  pid: number;
  command: string;
  address: string;
  port: number;
  wildcard: boolean;
  loopback: boolean;
  dialHost: string;
}

async function run(command: string, args: string[]): Promise<string> {
  const { stdout } = await exec(command, args, {
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...commandEnvironment(), LC_ALL: "C" },
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
  const entries = await platformProcessSnapshot();
  return entries.map((entry) => ({
    pid: entry.pid,
    ppid: entry.ppid,
    pgid: entry.pgid,
    session: entry.session,
    birth: entry.birth,
  }));
}

function parseAddress(
  value: string,
):
  | { address: string; port: number; wildcard: boolean; loopback: boolean; dialHost: string }
  | undefined {
  const separator = value.lastIndexOf(":");
  if (separator < 0) return undefined;
  const port = Number(value.slice(separator + 1));
  if (!Number.isInteger(port) || port <= 0) return undefined;
  let host = value.slice(0, separator);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  const wildcard = host === "*" || host === "0.0.0.0" || host === "::";
  return {
    address: value,
    port,
    wildcard,
    loopback: host === "127.0.0.1" || host === "::1",
    dialHost: wildcard ? "127.0.0.1" : host,
  };
}

export async function listeningSockets(port: number): Promise<ListenerInfo[]> {
  if (process.platform === "win32") {
    const listeners = await windowsTcpListeners(port);
    const sockets: ListenerInfo[] = [];
    for (const listener of listeners) {
      const host = listener.address;
      const address =
        host.includes(":") && !host.startsWith("[")
          ? `[${host}]:${listener.port}`
          : `${host}:${listener.port}`;
      const parsed = parseAddress(address);
      if (parsed) sockets.push({ pid: listener.pid, command: "", ...parsed });
    }
    return sockets;
  }
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

function descendsFrom(processes: ProcessInfo[], pid: number, ancestorPid: number): boolean {
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

export interface ProbeInput {
  leaderPid: number;
  port: number;
}

export async function probeExecution(input: ProbeInput): Promise<ExecutionIdentity> {
  const processes = await processSnapshot();
  const leader = processes.find((item) => item.pid === input.leaderPid);
  if (!leader) throw new ServiceIdentityError("TERMINAL_NOT_RUNNING", "Terminal is not running");
  const sockets = await listeningSockets(input.port);
  if (sockets.length === 0)
    throw new ServiceIdentityError("LISTENER_NOT_FOUND", "No service is listening on that port");
  const owners = new Set(sockets.map((item) => item.pid));
  if (owners.size > 1)
    throw new ServiceIdentityError("LISTENER_OWNER_AMBIGUOUS", "Port has multiple listeners");
  const socket = sockets[0];
  const owner = processes.find((item) => item.pid === socket.pid);
  if (!owner) throw new ServiceIdentityError("LISTENER_OWNER_UNKNOWN", "Listener owner is unknown");
  if (!descendsFrom(processes, owner.pid, leader.pid)) {
    throw new ServiceIdentityError(
      "LISTENER_NOT_IN_TERMINAL_TREE",
      "Listener does not belong to this terminal",
    );
  }
  return {
    leaderPid: leader.pid,
    leaderBirth: leader.birth,
    session: leader.session,
    pid: owner.pid,
    birth: owner.birth,
    address: socket.address,
    dialHost: socket.dialHost,
    port: socket.port,
  };
}

export async function verifyExecution(identity: ExecutionIdentity): Promise<void> {
  const processes = await processSnapshot();
  const leader = processes.find((item) => item.pid === identity.leaderPid);
  if (!leader || leader.birth !== identity.leaderBirth) {
    throw new ServiceIdentityError("TERMINAL_IDENTITY_CHANGED", "Terminal identity changed");
  }
  const sockets = await listeningSockets(identity.port);
  const socket = sockets.find((item) => item.pid === identity.pid);
  if (!socket) throw new ServiceIdentityError("LISTENER_GONE", "Service endpoint is gone");
  if (socket.address !== identity.address) {
    throw new ServiceIdentityError("LISTENER_ADDRESS_CHANGED", "Service address changed");
  }
  const owner = processes.find((item) => item.pid === socket.pid);
  if (!owner || owner.birth !== identity.birth) {
    throw new ServiceIdentityError("LISTENER_IDENTITY_CHANGED", "Listener identity changed");
  }
  if (!descendsFrom(processes, owner.pid, identity.leaderPid)) {
    throw new ServiceIdentityError(
      "LISTENER_NOT_IN_TERMINAL_TREE",
      "Listener no longer belongs to this terminal",
    );
  }
}

export function parseExecutionIdentity(json: string): ExecutionIdentity {
  const value = JSON.parse(json) as Partial<ExecutionIdentity>;
  if (
    typeof value.leaderPid !== "number" ||
    typeof value.leaderBirth !== "string" ||
    typeof value.pid !== "number" ||
    typeof value.birth !== "string" ||
    typeof value.address !== "string" ||
    typeof value.port !== "number"
  ) {
    throw new ServiceIdentityError("IDENTITY_INVALID", "Stored execution identity is invalid");
  }
  return {
    leaderPid: value.leaderPid,
    leaderBirth: value.leaderBirth,
    session: value.session ?? 0,
    pid: value.pid,
    birth: value.birth,
    address: value.address,
    dialHost: value.dialHost ?? value.address.replace(/^\[|\]$/g, "").split(":")[0],
    port: value.port,
  };
}
