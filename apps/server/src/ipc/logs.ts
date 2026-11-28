import { open } from "node:fs/promises";
import { findMainLogFile } from "../log-files.js";

const MAX_TAIL_BYTES = 1024 * 1024;

export async function readNewestLogLines(dataDir: string, lines: number): Promise<string[]> {
  const newest = await findMainLogFile(dataDir);

  if (newest === null) {
    return [];
  }

  const handle = await open(newest, "r");

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
