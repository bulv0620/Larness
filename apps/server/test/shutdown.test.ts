import { describe, expect, it, vi } from "vitest";
import { acquireInstanceLock, inspectInstanceLock } from "../src/bootstrap/lock.js";
import { createShutdown } from "../src/bootstrap/shutdown.js";
import { withTempDir } from "./helpers.js";

function stubLogger() {
  return {
    info: vi.fn(),
    flush: vi.fn((callback: () => void) => callback()),
  };
}

describe("createShutdown", () => {
  it("closes once, releases the lock and flushes the logger", async () => {
    await withTempDir(async (dir) => {
      const lock = await acquireInstanceLock(dir, { version: "test" });
      const app = { close: vi.fn(async () => undefined) };
      const logger = stubLogger();
      const stop = createShutdown({ app, lock, logger });

      await Promise.all([stop("SIGTERM"), stop("SIGTERM")]);

      expect(app.close).toHaveBeenCalledTimes(1);
      expect(logger.flush).toHaveBeenCalledTimes(1);
      expect(await inspectInstanceLock(dir)).toBeNull();
    });
  });

  it("forces shutdown when close exceeds the timeout", async () => {
    await withTempDir(async (dir) => {
      let resolveClose: () => void = () => undefined;
      const closePromise = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });
      const lock = await acquireInstanceLock(dir, { version: "test" });
      const onTimeout = vi.fn();
      const stop = createShutdown({
        app: { close: () => closePromise },
        lock,
        logger: stubLogger(),
        timeoutMs: 20,
        onTimeout,
      });

      const pending = stop("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(onTimeout).toHaveBeenCalledTimes(1);

      resolveClose();
      await pending;
    });
  });
});
