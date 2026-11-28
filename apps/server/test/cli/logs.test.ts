import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { followLog, LOG_TAIL_LIMIT_BYTES, logFilePath, readLogTail } from "../../src/cli/logs.js";
import { findMainLogFile } from "../../src/log-files.js";
import { withTempDir } from "../helpers.js";

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("log paths", () => {
  it("uses fixed names inside the data directory", () => {
    expect(logFilePath("/data", "main")).toBe(path.join("/data", "logs", "larness.log"));
    expect(logFilePath("/data", "daemon")).toBe(path.join("/data", "logs", "daemon.log"));
  });

  it("finds the newest rotated main log", async () => {
    await withTempDir(async (dir) => {
      const logsDir = path.join(dir, "logs");
      await mkdir(logsDir, { recursive: true });
      await writeFile(path.join(logsDir, "larness.1.log"), "{}\n");
      await writeFile(path.join(logsDir, "notes.log"), "ignore\n");
      expect(await findMainLogFile(dir)).toBe(path.join(logsDir, "larness.1.log"));
    });
  });

  it("returns null when no main log exists", async () => {
    await withTempDir(async (dir) => {
      expect(await findMainLogFile(dir)).toBeNull();
    });
  });
});

describe("log tail", () => {
  it("returns the newest lines and reports truncation", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.log");
      const content = Array.from({ length: 300 }, (_, index) => `line ${index + 1}`).join("\n");
      await writeFile(file, `${content}\n`);

      const tail = await readLogTail(file, { lines: 200 });
      expect(tail?.lines).toHaveLength(200);
      expect(tail?.lines[0]).toBe("line 101");
      expect(tail?.lines.at(-1)).toBe("line 300");
      expect(tail?.truncated).toBe(true);
    });
  });

  it("does not report truncation when the file fits", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.log");
      await writeFile(file, "a\nb\n");
      expect(await readLogTail(file, { lines: 10 })).toEqual({
        lines: ["a", "b"],
        truncated: false,
      });
    });
  });

  it("drops a partial first line when reading a byte window", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.log");
      await writeFile(file, "aaaa\nbbbb\ncccc\n");
      const tail = await readLogTail(file, { lines: 10, maxBytes: 10 });
      expect(tail).toEqual({ lines: ["cccc"], truncated: true });
    });
  });

  it("returns null for a missing file", async () => {
    await withTempDir(async (dir) => {
      expect(await readLogTail(path.join(dir, "nope.log"), { lines: 10 })).toBeNull();
    });
  });

  it("keeps the default byte bound conservative", () => {
    expect(LOG_TAIL_LIMIT_BYTES).toBe(1_048_576);
  });
});

describe("log follow", () => {
  it("streams appended complete lines until aborted", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.log");
      await mkdir(dir, { recursive: true });
      await writeFile(file, "existing\n");

      const controller = new AbortController();
      const lines: string[] = [];
      const done = followLog(file, (line) => lines.push(line), {
        signal: controller.signal,
        intervalMs: 20,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await appendFile(file, "next 1\nnext 2\n");
      await waitFor(() => lines.length === 2);

      controller.abort();
      expect(await done).toBe("aborted");
      expect(lines).toEqual(["next 1", "next 2"]);
    });
  });

  it("reports a missing file", async () => {
    await withTempDir(async (dir) => {
      const controller = new AbortController();
      expect(
        await followLog(path.join(dir, "nope.log"), () => undefined, {
          signal: controller.signal,
        }),
      ).toBe("missing");
    });
  });

  it("stops when the file is truncated or replaced", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.log");
      await writeFile(file, "existing line\n");

      const controller = new AbortController();
      const done = followLog(file, () => undefined, {
        signal: controller.signal,
        intervalMs: 20,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      await writeFile(file, "x\n");
      expect(await done).toBe("replaced");
    });
  });
});
