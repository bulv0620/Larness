import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configFilePath } from "../../src/bootstrap/config.js";
import { inspectInstanceLock } from "../../src/bootstrap/lock.js";
import { startServer } from "../../src/bootstrap/start.js";
import { getMeta } from "../../src/db/repositories/meta.js";
import { ipcTokenPath } from "../../src/ipc/address.js";
import { connectIpc } from "../../src/ipc/client.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

const PASSWORD = "correct horse battery staple";

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();

  while (!(await check())) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("condition not met in time");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("IPC init integration", () => {
  it("initializes once, writes config, audits, and reports status", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });
      const client = await connectIpc({ dataDir: dir, client: "tui" });

      try {
        const remoteInit = await running.app.inject({
          method: "POST",
          url: "/api/init",
          payload: { adminPassword: PASSWORD },
        });
        expect(remoteInit.statusCode).toBe(404);
        expect(await client.request("init.status")).toMatchObject({
          initialized: false,
          requiredFields: [],
        });
        await expect(
          client.request("init.apply", {
            adminPassword: "short",
            host: "127.0.0.1",
            port,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

        const result = await client.request("init.apply", {
          host: "127.0.0.1",
          port,
          publicUrl: null,
          channel: "stable",
        });

        expect(result).toMatchObject({
          ok: true,
          origin: `http://localhost:${port}`,
          rpId: "localhost",
        });
        expect(await client.request("init.status")).toMatchObject({ initialized: true });

        await expect(
          client.request("init.apply", {
            host: "127.0.0.1",
            port,
          }),
        ).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });

        const status = (await client.request("system.status")) as {
          initialized: boolean;
          db: { ok: boolean; schemaVersion: number };
          ipc: { clients: number };
        };
        expect(status.initialized).toBe(true);
        expect(status.db).toMatchObject({ ok: true, schemaVersion: 7 });
        expect(status.ipc.clients).toBe(1);

        const doctor = (await client.request("system.doctor")) as {
          checks: { id: string; status: string }[];
        };
        expect(doctor.checks.find((check) => check.id === "database")?.status).toBe("ok");

        const audit = (await client.request("audit.tail", { limit: 10 })) as {
          items: { action: string; details: unknown }[];
        };
        expect(audit.items[0]?.action).toBe("auth.init");
        expect(JSON.stringify(audit.items)).not.toContain(PASSWORD);

        const file = configFilePath(dir);
        const info = await stat(file);

        if (process.platform !== "win32") {
          expect(info.mode & 0o777).toBe(0o600);
        }

        const config = JSON.parse(await readFile(file, "utf8")) as {
          server: { port: number };
          webauthn: { rpId: string };
        };
        expect(config.server.port).toBe(port);
        expect(config.webauthn.rpId).toBe("localhost");
      } finally {
        client.close();
        await running.shutdown("test");
      }
    });
  });

  it("allows only one concurrent init over IPC", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });
      const first = await connectIpc({ dataDir: dir, client: "tui-1" });
      const second = await connectIpc({ dataDir: dir, client: "tui-2" });
      const payload = {
        host: "127.0.0.1",
        port,
      };

      try {
        const results = await Promise.allSettled([
          first.request("init.apply", payload),
          second.request("init.apply", payload),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected).toMatchObject({ reason: { code: "ALREADY_INITIALIZED" } });
      } finally {
        first.close();
        second.close();
        await running.shutdown("test");
      }
    });
  });

  it("shuts the server down through server.shutdown", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });
      const client = await connectIpc({ dataDir: dir, client: "tui" });

      try {
        await expect(client.request("server.shutdown", {})).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
        });
        await client.request("server.shutdown", { confirm: true }).catch(() => undefined);
        await waitUntil(async () => (await inspectInstanceLock(dir)) === null);

        await expect(stat(ipcTokenPath(dir))).rejects.toThrow();
        await expect(stat(path.join(dir, "ipc", "larness.sock"))).rejects.toThrow();
      } finally {
        client.close();
        await running.shutdown("test");
      }
    });
  });

  it("refuses to connect without a token file", async () => {
    await withTempDir(async (dir) => {
      await expect(connectIpc({ dataDir: dir })).rejects.toBeDefined();
    });
  });
  it("keeps business APIs closed if publication completion fails and recovers on restart", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const running = await startServer({ env, logDestination: createLogSink().stream });
      const client = await connectIpc({ dataDir: dir, client: "tui" });
      try {
        running.sqlite.exec(
          "CREATE TRIGGER fail_publish BEFORE DELETE ON app_meta WHEN OLD.key = 'init_pending' BEGIN SELECT RAISE(ABORT, 'disk completion failure'); END",
        );
        await expect(
          client.request("init.apply", { host: "127.0.0.1", port }),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        const pending = getMeta(running.db, "init_pending");
        expect(pending).not.toBeNull();
        expect(pending).not.toContain(PASSWORD);
        expect(pending).not.toContain("argon2");
        expect(await client.request("init.status")).toMatchObject({ initialized: false });
        const response = await running.app.inject({ method: "GET", url: "/api/projects" });
        expect(response.statusCode).toBe(409);
        expect(response.json().error.code).toBe("NOT_INITIALIZED");
        running.sqlite.exec("DROP TRIGGER fail_publish");
      } finally {
        client.close();
        await running.shutdown("test");
      }
      const restarted = await startServer({ env, logDestination: createLogSink().stream });
      try {
        expect(getMeta(restarted.db, "init_pending")).toBeNull();
        const response = await restarted.app.inject({ method: "GET", url: "/api/bootstrap" });
        expect(response.json().initialized).toBe(true);
      } finally {
        await restarted.shutdown("test");
      }
    });
  });
});
