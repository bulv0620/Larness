import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../src/bootstrap/start.js";
import { runDoctor } from "../src/doctor.js";
import { ensureDataDirs } from "../src/platform/paths.js";
import { collectStatus } from "../src/status.js";
import { createLogSink, getFreePort, withTempDir, writeConfig } from "./helpers.js";

describe("collectStatus", () => {
  it("reports a stopped, uninitialized server with honest placeholders", async () => {
    await withTempDir(async (dir) => {
      const status = await collectStatus({ dataDir: dir, env: {} });

      expect(status.initialized).toBe(false);
      expect(status.running).toBe(false);
      expect(status.pid).toBeNull();
      expect(status.listen).toEqual({ host: "127.0.0.1", port: 3210 });
      expect(status.db).toBeNull();
      expect(status.ipc).toBeNull();
      expect(status.sessions).toEqual({ online: 0, pendingPairings: 0 });
      expect(status.webauthn).toMatchObject({
        enabled: true,
        origin: "http://localhost:3210",
        rpId: "localhost",
      });
      expect(status.warnings.length).toBeGreaterThan(0);
    });
  });

  it("reports running state from the lock file", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });

      try {
        const status = await collectStatus({ dataDir: dir, env });
        expect(status.running).toBe(true);
        expect(status.pid).toBe(process.pid);
        expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
        expect(status.db).toMatchObject({ ok: true, schemaVersion: 19 });
      } finally {
        await running.shutdown("test");
      }
    });
  });
});

describe("runDoctor", () => {
  it("returns the required checks for a healthy data directory", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await ensureDataDirs(root);
      await chmod(root, 0o700);
      const port = await getFreePort();

      const report = await runDoctor({
        dataDir: root,
        env: { LARNESS_DATA_DIR: root, LARNESS_PORT: String(port) },
      });

      const ids = report.checks.map((check) => check.id);
      expect(ids).toEqual(
        expect.arrayContaining([
          "node",
          "data-dir",
          "data-dir-permissions",
          "config",
          "port",
          "database",
          "migrations",
          "clock",
          "webauthn",
          "https",
        ]),
      );
      expect(report.checks.some((check) => check.status === "fail")).toBe(false);
    });
  });

  it("reports database and migration health after the first start", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });

      try {
        const report = await runDoctor({ dataDir: dir, env });
        expect(report.checks.find((check) => check.id === "database")?.status).toBe("ok");
        expect(report.checks.find((check) => check.id === "migrations")?.status).toBe("ok");
      } finally {
        await running.shutdown("test");
      }
    });
  });

  it("fails the config check when config.json is invalid", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "data"), { recursive: true, mode: 0o700 });
      await writeConfig(path.join(dir, "data"), { version: 1 });

      const report = await runDoctor({
        dataDir: path.join(dir, "data"),
        env: { LARNESS_PORT: String(await getFreePort()) },
      });

      expect(report.checks.find((check) => check.id === "config")?.status).toBe("fail");
    });
  });

  it("fails the port check when the port is taken and no server is running", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await ensureDataDirs(root);
      const port = await getFreePort();
      const blocker = await import("node:net").then(({ createServer }) => createServer());
      await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));

      try {
        const report = await runDoctor({
          dataDir: root,
          env: { LARNESS_DATA_DIR: root, LARNESS_PORT: String(port) },
        });

        expect(report.checks.find((check) => check.id === "port")?.status).toBe("fail");
      } finally {
        await new Promise<void>((resolve, reject) =>
          blocker.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  });
});
