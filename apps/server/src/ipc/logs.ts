import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MAX_TAIL_BYTES = 1024 * 1024;

export async function readNewestLogLines(dataDir: string, lines: number): Promise<string[]> {
  const logsDir = path.join(dataDir, "logs");
  let entries: string[];

  try {
    entries = await readdir(logsDir);
  } catch {
    return [];
  }

  let newest: { file: string; mtime: number } | null = null;

  for (const entry of entries) {
    if (!/^larness(\..+)?\.log$/.test(entry)) {
      continue;
    }

    try {
      const info = await stat(path.join(logsDir, entry));

      if (newest === null || info.mtimeMs > newest.mtime) {
        newest = { file: path.join(logsDir, entry), mtime: info.mtimeMs };
      }
    } catch {
      // Skip files that disappear during rotation.
    }
  }

  if (newest === null) {
    return [];
  }

  const handle = await open(newest.file, "r");

  try {
    const info = await handle.stat();
    const start = Math.max(0, info.size - MAX_TAIL_BYTES);
    const length = info.size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    return buffer
      .toString("utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(-lines);
  } finally {
    await handle.close();
  }
}
