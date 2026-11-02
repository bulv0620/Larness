import { lstat, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const DAY_MS = 86_400_000;
const LOG_FILE = /^larness\.\d+\.log$/;

export async function pruneExpiredLogs(
  dataDir: string,
  retentionDays: number,
  now = Date.now(),
): Promise<number> {
  const directory = path.join(dataDir, "logs");
  const names = await readdir(directory);
  let removed = 0;
  for (const name of names) {
    if (!LOG_FILE.test(name)) continue;
    const file = path.join(directory, name);
    try {
      const info = await lstat(file);
      if (info.isFile() && info.mtimeMs < now - retentionDays * DAY_MS) {
        await unlink(file);
        removed += 1;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return removed;
}

export function startLogRetention(
  dataDir: string,
  retentionDays: number,
  logger: { warn(fields: Record<string, unknown>, message: string): void },
  options: { prune?: typeof pruneExpiredLogs } = {},
): { stop(): Promise<void> } {
  const prune = options.prune ?? pruneExpiredLogs;
  let pending: Promise<void> | null = null;
  const run = (): void => {
    pending ??= prune(dataDir, retentionDays)
      .then(() => undefined)
      .catch((error: unknown) => logger.warn({ err: error }, "log retention failed"))
      .finally(() => {
        pending = null;
      });
  };
  run();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return {
    async stop() {
      clearInterval(timer);
      await pending;
    },
  };
}
