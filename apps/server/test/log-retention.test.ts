import { mkdir, readdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { pruneExpiredLogs, startLogRetention } from "../src/bootstrap/log-retention.js";
import { withTempDir } from "./helpers.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 2);

describe("log retention", () => {
  it("retains every recent rotation and only removes expired Larness log files", async () => {
    await withTempDir(async (dir) => {
      const logs = path.join(dir, "logs");
      await mkdir(logs);
      for (const name of ["larness.1.log", "larness.2.log", "larness.3.log", "other.1.log"]) {
        const file = path.join(logs, name);
        await writeFile(file, "log");
        const modified = name === "larness.3.log" || name === "other.1.log" ? NOW - 15 * DAY : NOW;
        await utimes(file, modified / 1000, modified / 1000);
      }
      const outside = path.join(dir, "outside");
      await writeFile(outside, "keep");
      await utimes(outside, (NOW - 20 * DAY) / 1000, (NOW - 20 * DAY) / 1000);
      if (process.platform !== "win32") {
        await symlink(outside, path.join(logs, "larness.4.log"));
      }
      await mkdir(path.join(logs, "larness.5.log"));
      await pruneExpiredLogs(dir, 14, NOW);
      const remaining = await readdir(logs);
      expect(remaining).toContain("larness.1.log");
      expect(remaining).toContain("larness.2.log");
      expect(remaining).not.toContain("larness.3.log");
      expect(remaining).toContain("other.1.log");
      expect(remaining).toContain("larness.5.log");
      expect((await stat(outside)).isFile()).toBe(true);
      if (process.platform !== "win32") expect(remaining).toContain("larness.4.log");
    });
  });

  it("cleans on startup and daily, reports errors, and stops its timer", async () => {
    vi.useFakeTimers();
    try {
      const prune = vi.fn().mockRejectedValueOnce(new Error("disk error")).mockResolvedValue(0);
      const logger = { warn: vi.fn() };
      const retention = startLogRetention("/unused", 14, logger, { prune });
      await vi.advanceTimersByTimeAsync(0);
      expect(prune).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(DAY);
      expect(prune).toHaveBeenCalledTimes(2);
      await retention.stop();
      await vi.advanceTimersByTimeAsync(DAY);
      expect(prune).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
