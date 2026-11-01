import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../src/bootstrap/config.js";
import { InstanceLockedError, inspectInstanceLock } from "../src/bootstrap/lock.js";
import { startServer } from "../src/bootstrap/start.js";
import { DataDirError } from "../src/platform/paths.js";
import { collectStatus } from "../src/status.js";
import { createLogSink, getFreePort, testConfig, withTempDir, writeConfig } from "./helpers.js";

function envFor(dataDir: string, port: number): NodeJS.ProcessEnv {
  return { LARNESS_DATA_DIR: dataDir, LARNESS_PORT: String(port) };
}

describe("startServer", () => {
  it("starts, serves health, reports running and releases the lock", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const sink = createLogSink();
      const running = await startServer({
        env: envFor(dir, port),
        logDestination: sink.stream,
        version: "test",
      });

      try {
        const response = await running.app.inject({ method: "GET", url: "/api/health" });
        expect(response.statusCode).toBe(200);
        expect(running.webAuthn.origin).toBe(`http://localhost:${port}`);
        expect(running.schemaVersion).toBe(1);
        expect(existsSync(running.dbPath)).toBe(true);

        const status = await collectStatus({ dataDir: dir, env: envFor(dir, port) });
        expect(status.running).toBe(true);
        expect(status.pid).toBe(process.pid);
        expect(status.listen).toEqual({ host: "127.0.0.1", port });
      } finally {
        await running.shutdown("test");
      }

      expect(await inspectInstanceLock(dir)).toBeNull();
    });
  });

  it("rejects a second instance on the same data directory", async () => {
    await withTempDir(async (dir) => {
      const firstPort = await getFreePort();
      const secondPort = await getFreePort();
      const first = await startServer({
        env: envFor(dir, firstPort),
        logDestination: createLogSink().stream,
      });

      try {
        await expect(
          startServer({
            env: envFor(dir, secondPort),
            logDestination: createLogSink().stream,
          }),
        ).rejects.toBeInstanceOf(InstanceLockedError);
      } finally {
        await first.shutdown("test");
      }
    });
  });

  it("exits cleanly when the port is already in use", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const blocker = createServer();
      await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));

      try {
        await expect(
          startServer({ env: envFor(dir, port), logDestination: createLogSink().stream }),
        ).rejects.toMatchObject({ code: "EADDRINUSE" });
      } finally {
        await new Promise<void>((resolve, reject) =>
          blocker.close((error) => (error ? reject(error) : resolve())),
        );
      }

      expect(await inspectInstanceLock(dir)).toBeNull();
    });
  });

  it("refuses to start with an invalid config", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { port: 70000 } }));

      await expect(
        startServer({ env: envFor(dir, 3299), logDestination: createLogSink().stream }),
      ).rejects.toBeInstanceOf(ConfigError);
    });
  });

  it("refuses to start when the data directory is not writable", async () => {
    if (process.platform === "win32") {
      return;
    }

    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await mkdir(root, { mode: 0o700 });
      await chmod(root, 0o500);

      try {
        await expect(
          startServer({ env: envFor(root, 3299), logDestination: createLogSink().stream }),
        ).rejects.toBeInstanceOf(DataDirError);
      } finally {
        await chmod(root, 0o700);
      }
    });
  });

  it("refuses to start when the database file is corrupt", async () => {
    await withTempDir(async (dir) => {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(dir, "larness.db"), "not a database", { mode: 0o600 });

      await expect(
        startServer({ env: envFor(dir, 3299), logDestination: createLogSink().stream }),
      ).rejects.toThrow();

      expect(await inspectInstanceLock(dir)).toBeNull();
    });
  });
});
