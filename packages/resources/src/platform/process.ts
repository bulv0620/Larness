import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { commandEnvironment, powerShellArguments, windowsPowerShell } from "./environment.js";

const exec = promisify(execFile);

export interface ProcessEntry {
  pid: number;
  ppid: number;
  pgid: number;
  session: number;
  birth: string;
  command: string;
}

export interface TcpListener {
  pid: number;
  address: string;
  port: number;
}

async function runPowerShell(script: string, timeoutMs = 10_000): Promise<string> {
  const { stdout } = await exec(windowsPowerShell(), powerShellArguments(script), {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    env: commandEnvironment(),
  });
  return stdout;
}

async function posixSnapshot(): Promise<ProcessEntry[]> {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,pgid=,sess=,stat=,lstart="], {
    timeout: 5000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...commandEnvironment(), LC_ALL: "C" },
  });
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[4]?.startsWith("Z")) continue;
    entries.push({
      pid: Number(fields[0]),
      ppid: Number(fields[1]),
      pgid: Number(fields[2]),
      session: Number(fields[3]),
      birth: fields.slice(5).join(" "),
      command: "",
    });
  }
  return entries;
}

const WINDOWS_SNAPSHOT = String.raw`
$ErrorActionPreference = 'Stop'
Get-CimInstance Win32_Process | ForEach-Object {
  $born = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().Ticks } else { 0 }
  $command = if ($_.CommandLine) { $_.CommandLine -replace "[\r\n]+", " " } else { "" }
  [Console]::Out.WriteLine(("{0}|{1}|{2}|{3}" -f $_.ProcessId, $_.ParentProcessId, $born, $command))
}
`;

async function windowsSnapshot(): Promise<ProcessEntry[]> {
  const stdout = await runPowerShell(WINDOWS_SNAPSHOT, 15_000);
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const first = line.indexOf("|");
    const second = line.indexOf("|", first + 1);
    const third = line.indexOf("|", second + 1);
    if (first < 0 || second < 0 || third < 0) continue;
    const pid = Number(line.slice(0, first));
    const ppid = Number(line.slice(first + 1, second));
    const birth = line.slice(second + 1, third);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(ppid)) continue;
    entries.push({
      pid,
      ppid,
      pgid: 0,
      session: 0,
      birth,
      command: line.slice(third + 1),
    });
  }
  return entries;
}

let snapshotCache: { at: number; entries: ProcessEntry[] } | null = null;
let snapshotInFlight: Promise<ProcessEntry[]> | null = null;

/**
 * Snapshot every live process. Windows uses CIM because `ps` is unavailable;
 * repeated CIM calls are expensive, so a very short cache coalesces the
 * per-second reconciliation probes without hiding a stopped process for long.
 */
export function processSnapshot(): Promise<ProcessEntry[]> {
  if (process.platform !== "win32") return posixSnapshot();
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.at < 300) return Promise.resolve(snapshotCache.entries);
  if (snapshotInFlight) return snapshotInFlight;
  snapshotInFlight = windowsSnapshot()
    .catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return windowsSnapshot();
    })
    .then((entries) => {
      snapshotCache = { at: Date.now(), entries };
      return entries;
    })
    .finally(() => {
      snapshotInFlight = null;
    });
  return snapshotInFlight;
}

export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Descendants of `pid` in parent-before-child order, including `pid` itself. */
export async function processTreePids(pid: number): Promise<number[]> {
  const entries = await processSnapshot();
  const byParent = new Map<number, number[]>();
  for (const entry of entries) {
    const children = byParent.get(entry.ppid) ?? [];
    children.push(entry.pid);
    byParent.set(entry.ppid, children);
  }
  const result: number[] = [];
  const queue = [pid];
  const seen = new Set<number>();
  while (queue.length) {
    const current = queue.shift() as number;
    if (seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    for (const child of byParent.get(current) ?? []) queue.push(child);
  }
  return result;
}

async function taskkill(args: string[]): Promise<void> {
  try {
    await exec("taskkill", args, {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: commandEnvironment(),
    });
  } catch {
    // taskkill exits non-zero when the target already exited.
  }
}

/**
 * Force-stop a process tree on Windows. taskkill walks the live parent/child
 * tree; known descendants are then retried individually so a parent exiting
 * first cannot leave an orphan behind.
 */
export async function terminateProcessTree(pid: number, graceMs = 2_000): Promise<boolean> {
  if (process.platform !== "win32") throw new Error("Windows process termination only");
  if (pid === process.pid || !Number.isSafeInteger(pid) || pid <= 0) return false;
  const known = await processTreePids(pid).catch(() => [pid]);
  await taskkill(["/PID", String(pid), "/T", "/F"]);
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    for (const target of known) {
      if (target !== pid && processAlive(target))
        await taskkill(["/PID", String(target), "/T", "/F"]);
    }
    if (!processAlive(pid) && known.every((target) => !processAlive(target))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processAlive(pid) && known.every((target) => !processAlive(target));
}

export async function processCommandLine(pid: number): Promise<string | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (process.platform === "win32") {
    const script = String.raw`
$ErrorActionPreference = 'Stop'
$process = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"
if ($process -and $process.CommandLine) { [Console]::Out.Write($process.CommandLine) }
`;
    try {
      const value = (await runPowerShell(script, 5000)).trim();
      return value.length ? value : null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], {
      timeout: 2000,
      maxBuffer: 256 * 1024,
      env: { ...commandEnvironment(), LC_ALL: "C" },
    });
    const value = stdout.trim();
    return value.length ? value : null;
  } catch {
    return null;
  }
}

const listenerCache = new Map<number, { at: number; listeners: TcpListener[] }>();
const listenerInFlight = new Map<number, Promise<TcpListener[]>>();

/** TCP listeners for a loopback-relevant port on Windows. */
export async function windowsTcpListeners(port: number): Promise<TcpListener[]> {
  if (process.platform !== "win32") throw new Error("Windows listener lookup only");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  const cached = listenerCache.get(port);
  if (cached && Date.now() - cached.at < 1_000) return cached.listeners;
  const pending = listenerInFlight.get(port);
  if (pending) return pending;
  const script = String.raw`
$ErrorActionPreference = 'Stop'
Get-NetTCPConnection -State Listen -LocalPort ${port} | ForEach-Object {
  [Console]::Out.WriteLine(("{0}|{1}|{2}" -f $_.OwningProcess, $_.LocalAddress, $_.LocalPort))
}
`;
  const task = (async (): Promise<TcpListener[]> => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let stdout: string;
      try {
        stdout = await runPowerShell(script, 8_000);
      } catch {
        if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 150));
        continue;
      }
      const listeners: TcpListener[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line) continue;
        const first = line.indexOf("|");
        const second = line.indexOf("|", first + 1);
        if (first < 0 || second < 0) continue;
        const pid = Number(line.slice(0, first));
        const address = line.slice(first + 1, second);
        const value = Number(line.slice(second + 1));
        if (!Number.isSafeInteger(pid) || !address || !Number.isInteger(value)) continue;
        listeners.push({ pid, address, port: value });
      }
      if (listeners.length > 0 || attempt === 4) return listeners;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return [];
  })()
    .then((listeners) => {
      listenerCache.set(port, { at: Date.now(), listeners });
      return listeners;
    })
    .finally(() => {
      listenerInFlight.delete(port);
    });
  listenerInFlight.set(port, task);
  return task;
}
