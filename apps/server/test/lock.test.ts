import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireInstanceLock,
  InstanceLockedError,
  inspectInstanceLock,
  lockFilePath,
  releaseInstanceLock,
} from "../src/bootstrap/lock.js";
import { withTempDir } from "./helpers.js";

describe("instance lock", () => {
  it("creates a 0600 lock file with pid, start time and version", async () => {
    await withTempDir(async (dir) => {
      await acquireInstanceLock(dir, { version: "test", now: () => 1761900000000 });

      const info = await stat(lockFilePath(dir));
      if (process.platform !== "win32") {
        expect(info.mode & 0o777).toBe(0o600);
      }

      const inspected = await inspectInstanceLock(dir);
      expect(inspected?.alive).toBe(true);
      expect(inspected?.record).toMatchObject({
        pid: process.pid,
        startedAt: 1761900000000,
        version: "test",
      });
    });
  });

  it("rejects a second holder while the pid is alive", async () => {
    await withTempDir(async (dir) => {
      const first = await acquireInstanceLock(dir, { version: "test" });

      try {
        await expect(acquireInstanceLock(dir, { version: "test" })).rejects.toMatchObject({
          pid: process.pid,
        });
        await expect(acquireInstanceLock(dir, { version: "test" })).rejects.toBeInstanceOf(
          InstanceLockedError,
        );
      } finally {
        await releaseInstanceLock(first);
      }
    });
  });

  it("replaces a stale lock whose pid is gone", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        lockFilePath(dir),
        `${JSON.stringify({ pid: 2_147_483_647, startedAt: 1, version: "dead" })}\n`,
        { mode: 0o600 },
      );

      const lock = await acquireInstanceLock(dir, { version: "test" });

      expect(lock.pid).toBe(process.pid);
      await releaseInstanceLock(lock);
    });
  });

  it("does not remove a lock owned by another pid", async () => {
    await withTempDir(async (dir) => {
      const lockPath = lockFilePath(dir);
      await writeFile(lockPath, `${JSON.stringify({ pid: 123, startedAt: 1, version: "x" })}\n`, {
        mode: 0o600,
      });

      await releaseInstanceLock({
        path: lockPath,
        pid: process.pid,
        startedAt: 1,
        version: "test",
      });

      expect((await stat(lockPath)).isFile()).toBe(true);
    });
  });

  it("releases the lock so a later start can acquire it", async () => {
    await withTempDir(async (dir) => {
      const first = await acquireInstanceLock(dir, { version: "test" });
      await releaseInstanceLock(first);

      const second = await acquireInstanceLock(dir, { version: "test" });
      await releaseInstanceLock(second);

      expect(await inspectInstanceLock(dir)).toBeNull();
    });
  });

  it("fails closed on an unreadable lock file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "larness.lock"), "not json", { mode: 0o600 });

      await expect(acquireInstanceLock(dir, { version: "test" })).rejects.toBeInstanceOf(
        InstanceLockedError,
      );
    });
  });
});
