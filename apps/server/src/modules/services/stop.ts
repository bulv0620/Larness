import { type ExecutionIdentity, processSnapshot, ServiceIdentityError } from "./identity.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tree(processes: Awaited<ReturnType<typeof processSnapshot>>, root: number): number[] {
  const byParent = new Map<number, number[]>();
  for (const item of processes) {
    byParent.set(item.ppid, [...(byParent.get(item.ppid) ?? []), item.pid]);
  }
  const depth = new Map<number, number>();
  const walk = (pid: number, level: number) => {
    depth.set(pid, level);
    for (const child of byParent.get(pid) ?? []) walk(child, level + 1);
  };
  walk(root, 0);
  return [...depth.entries()].sort((a, b) => b[1] - a[1]).map(([pid]) => pid);
}

export async function stopExecution(identity: ExecutionIdentity): Promise<void> {
  const before = await processSnapshot();
  const target = before.find((item) => item.pid === identity.pid && item.birth === identity.birth);
  if (!target) throw new ServiceIdentityError("LISTENER_GONE", "Service process is gone");
  if (identity.pid === identity.leaderPid) {
    throw new ServiceIdentityError(
      "TERMINAL_SHELL_LISTENER",
      "The listening process is the terminal shell itself",
    );
  }
  const pids = tree(before, identity.pid);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process exited between the snapshot and the signal.
    }
  }
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline && pids.some((pid) => alive(pid))) await delay(50);
  for (const pid of pids) {
    if (!alive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  await delay(100);
  if (pids.some((pid) => alive(pid))) {
    throw new ServiceIdentityError("STOP_UNCONFIRMED", "Service process did not stop");
  }
}
