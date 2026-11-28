import { type FileHandle, open } from "node:fs/promises";
import path from "node:path";

export const LOG_TAIL_LIMIT_BYTES = 1_048_576;
const FOLLOW_INTERVAL_MS = 150;

export type LogSource = "main" | "daemon";

export function logFilePath(dataDir: string, source: LogSource): string {
  return path.join(dataDir, "logs", source === "daemon" ? "daemon.log" : "larness.log");
}

export interface LogTail {
  lines: string[];
  truncated: boolean;
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export async function readLogTail(
  file: string,
  options: { lines: number; maxBytes?: number },
): Promise<LogTail | null> {
  let handle: FileHandle;

  try {
    handle = await open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  try {
    const info = await handle.stat();
    const maxBytes = options.maxBytes ?? LOG_TAIL_LIMIT_BYTES;
    const start = Math.max(0, info.size - maxBytes);
    const length = info.size - start;

    if (length === 0) {
      return { lines: [], truncated: false };
    }

    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    let text = buffer.toString("utf8");

    if (start > 0) {
      const newline = text.indexOf("\n");
      text = newline === -1 ? "" : text.slice(newline + 1);
    }

    const all = splitLines(text);
    const truncated = start > 0 || all.length > options.lines;

    return {
      lines: all.length > options.lines ? all.slice(-options.lines) : all,
      truncated,
    };
  } finally {
    await handle.close();
  }
}

async function readFrom(
  file: string,
  offset: number,
  maxBytes: number,
): Promise<{ text: string; next: number } | null> {
  let handle: FileHandle;

  try {
    handle = await open(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  try {
    const info = await handle.stat();

    if (info.size < offset) {
      return { text: "", next: info.size };
    }

    if (info.size === offset) {
      return { text: "", next: offset };
    }

    const length = Math.min(info.size - offset, maxBytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, offset);
    return { text: buffer.toString("utf8"), next: offset + length };
  } finally {
    await handle.close();
  }
}

export type FollowEnd = "aborted" | "missing" | "replaced";

export async function followLog(
  file: string,
  onLine: (line: string) => void,
  options: { signal: AbortSignal; intervalMs?: number },
): Promise<FollowEnd> {
  let offset: number;

  try {
    const handle = await open(file, "r");
    try {
      offset = (await handle.stat()).size;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }

  let pending = "";
  const interval = options.intervalMs ?? FOLLOW_INTERVAL_MS;

  return new Promise<FollowEnd>((resolve) => {
    let finished = false;
    const finish = (reason: FollowEnd) => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      options.signal.removeEventListener("abort", onAbort);
      resolve(reason);
    };
    const onAbort = () => finish("aborted");
    const timer = setInterval(() => {
      void (async () => {
        try {
          const chunk = await readFrom(file, offset, LOG_TAIL_LIMIT_BYTES);

          if (chunk === null) {
            finish("missing");
            return;
          }

          if (chunk.next < offset) {
            finish("replaced");
            return;
          }

          if (chunk.text.length === 0) return;

          offset = chunk.next;
          pending += chunk.text;
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";

          for (const line of lines) {
            onLine(line);
          }
        } catch {
          finish("missing");
        }
      })();
    }, interval);

    if (options.signal.aborted) {
      finish("aborted");
      return;
    }
    options.signal.addEventListener("abort", onAbort, { once: true });
  });
}
