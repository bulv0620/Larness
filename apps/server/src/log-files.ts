import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAIN_LOG_PATTERN = /^larness(\..+)?\.log$/;

export async function findMainLogFile(dataDir: string): Promise<string | null> {
  const logsDir = path.join(dataDir, "logs");
  let entries: string[];

  try {
    entries = await readdir(logsDir);
  } catch {
    return null;
  }

  let newest: { file: string; mtime: number } | null = null;

  for (const entry of entries) {
    if (!MAIN_LOG_PATTERN.test(entry)) continue;

    try {
      const info = await stat(path.join(logsDir, entry));
      if (newest === null || info.mtimeMs > newest.mtime) {
        newest = { file: path.join(logsDir, entry), mtime: info.mtimeMs };
      }
    } catch {
      // Skip files that disappear during rotation.
    }
  }

  return newest?.file ?? null;
}
