import { describe, expect, it, vi } from "vitest";
import { startServer } from "../src/bootstrap/start.js";
import { createLogSink, getFreePort, withTempDir } from "./helpers.js";

const state = vi.hoisted(() => ({ events: [] as string[], fail: false }));
vi.mock("../src/bootstrap/log-retention.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bootstrap/log-retention.js")>();
  return {
    ...actual,
    pruneExpiredLogs: async (...args: Parameters<typeof actual.pruneExpiredLogs>) => {
      state.events.push("prune:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      state.events.push("prune:finished");
      if (state.fail) throw new Error("log pruning unavailable");
      return actual.pruneExpiredLogs(...args);
    },
    startLogRetention: (...args: Parameters<typeof actual.startLogRetention>) => {
      state.events.push("schedule");
      return actual.startLogRetention(...args);
    },
  };
});
vi.mock("../src/bootstrap/logger.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bootstrap/logger.js")>();
  return {
    ...actual,
    createLogger: (...args: Parameters<typeof actual.createLogger>) => {
      state.events.push("logger:open");
      return actual.createLogger(...args);
    },
  };
});

describe("startup log ordering", () => {
  it.each([false, true])(
    "waits for pruning before opening the logger (failure=%s)",
    async (fail) => {
      await withTempDir(async (dir) => {
        state.events = [];
        state.fail = fail;
        const sink = createLogSink();
        const running = await startServer({
          env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(await getFreePort()) },
          logDestination: sink.stream,
        });
        try {
          expect(state.events).toEqual([
            "prune:start",
            "prune:finished",
            "logger:open",
            "schedule",
          ]);
          if (fail) expect(sink.text()).toContain("log retention failed");
        } finally {
          await running.shutdown("test");
        }
      });
    },
  );
});
