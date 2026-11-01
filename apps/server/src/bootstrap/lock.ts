import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LockRecord {
  pid: number;
  startedAt: number;
  version: string;
}

export interface InstanceLock extends LockRecord {
  path: string;
}

export interface LockState {
  path: string;
  record: LockRecord | null;
  alive: boolean;
}

export class InstanceLockedError extends Error {
  readonly pid: number | null;

  constructor(pid: number | null, message?: string) {
    super(message ?? `another Larness instance is already running (pid ${pid ?? "unknown"})`);
    this.name = "InstanceLockedError";
    this.pid = pid;
  }
}

export function lockFilePath(dataDir: string): string {
  return path.join(dataDir, "larness.lock");
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseRecord(text: string): LockRecord | null {
  try {
    const value: unknown = JSON.parse(text);

    if (
      typeof value !== "object" ||
      value === null ||
      !("pid" in value) ||
      !("startedAt" in value) ||
      !("version" in value)
    ) {
      return null;
    }

    const { pid, startedAt, version } = value;

    if (
      typeof pid !== "number" ||
      !Number.isInteger(pid) ||
      pid <= 0 ||
      typeof startedAt !== "number" ||
      typeof version !== "string"
    ) {
      return null;
    }

    return { pid, startedAt, version };
  } catch {
    return null;
  }
}

async function readRecord(lockPath: string): Promise<LockRecord | null> {
  try {
    return parseRecord(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

export async function inspectInstanceLock(dataDir: string): Promise<LockState | null> {
  const lockPath = lockFilePath(dataDir);

  try {
    await readFile(lockPath);
  } catch {
    return null;
  }

  const record = await readRecord(lockPath);

  return {
    path: lockPath,
    record,
    alive: record !== null && isProcessAlive(record.pid),
  };
}

async function removeIfUnchanged(lockPath: string, expected: LockRecord): Promise<void> {
  try {
    const current = parseRecord(await readFile(lockPath, "utf8"));

    if (
      current === null ||
      current.pid !== expected.pid ||
      current.startedAt !== expected.startedAt
    ) {
      return;
    }

    await unlink(lockPath);
  } catch {
    // A missing or replaced lock is handled by the next acquisition attempt.
  }
}

export interface AcquireLockOptions {
  version: string;
  pid?: number;
  now?: () => number;
}

export async function acquireInstanceLock(
  dataDir: string,
  options: AcquireLockOptions,
): Promise<InstanceLock> {
  const lockPath = lockFilePath(dataDir);
  const record: LockRecord = {
    pid: options.pid ?? process.pid,
    startedAt: (options.now ?? Date.now)(),
    version: options.version,
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
      return { ...record, path: lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const existing = await readRecord(lockPath);

      if (existing === null) {
        throw new InstanceLockedError(
          null,
          `lock file is unreadable: ${lockPath}; verify no server is running before removing it`,
        );
      }

      if (isProcessAlive(existing.pid)) {
        throw new InstanceLockedError(existing.pid);
      }

      await removeIfUnchanged(lockPath, existing);
    }
  }

  throw new InstanceLockedError(
    null,
    "failed to acquire the instance lock after a stale-lock retry",
  );
}

export async function releaseInstanceLock(lock: InstanceLock): Promise<void> {
  const current = await readRecord(lock.path);

  if (current === null || current.pid !== lock.pid) {
    return;
  }

  try {
    await unlink(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
