import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APP_CONFIG } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { isInitialized } from "../../src/auth/initialized.js";
import { configFilePath, loadConfig } from "../../src/bootstrap/config.js";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { createAuthSettings, getAuthSettings } from "../../src/db/repositories/auth-settings.js";
import { getMeta, setMeta } from "../../src/db/repositories/meta.js";
import { recoverInitialization } from "../../src/init/recovery.js";
import { applyInit, buildInitConfig } from "../../src/init/service.js";
import { testConfig, withTempDir, writeConfig } from "../helpers.js";

const PASSWORD = "correct horse battery staple";

async function openMigrated(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function baseInput(overrides: Partial<Parameters<typeof buildInitConfig>[0]> = {}) {
  return {
    host: "127.0.0.1",
    port: 3210,
    publicUrl: null,
    channel: "stable" as const,
    ...overrides,
  };
}

describe("buildInitConfig", () => {
  it("rejects invalid public URLs", () => {
    expect(() => buildInitConfig(baseInput({ publicUrl: "https://example.com/app" }))).toThrow(
      /publicUrl/,
    );
  });

  it("derives canonical origin and RP ID, disabling passkeys for remote http", () => {
    const local = buildInitConfig(baseInput({ port: 4000 }));
    expect(local.webAuthn.origin).toBe("http://localhost:4000");
    expect(local.webAuthn.rpId).toBe("localhost");

    const remote = buildInitConfig(baseInput({ publicUrl: "http://example.com:4000" }));
    expect(remote.webAuthn.enabled).toBe(false);
    expect(remote.webAuthn.reason).toBe("remote_http");
  });
});

describe("applyInit", () => {
  it("writes config, auth settings, audit and marks the workspace initialized", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const result = await applyInit({
          db: opened.db,
          dataDir: dir,
          input: baseInput(),
          currentConfig: structuredClone(DEFAULT_APP_CONFIG),
          now: 1_000,
        });

        expect(result.origin).toBe("http://localhost:3210");
        expect(result.rpId).toBe("localhost");
        expect(result.restartRequired).toBe(false);

        const file = configFilePath(dir);
        const info = await stat(file);

        if (process.platform !== "win32") {
          expect(info.mode & 0o777).toBe(0o600);
        }

        const config = JSON.parse(await readFile(file, "utf8")) as {
          server: { host: string; port: number };
          preview: { enabled: boolean; port: number };
          webauthn: { origin: string; rpId: string };
        };
        expect(config.server).toMatchObject({ host: "127.0.0.1", port: 3210 });
        expect(config.preview).toEqual({ enabled: true, port: 3211 });
        expect(config.webauthn).toMatchObject({
          origin: "http://localhost:3210",
          rpId: "localhost",
        });

        expect(getAuthSettings(opened.db)?.adminHash).toBe("");
        expect(getAuthSettings(opened.db)?.adminHash).not.toContain(PASSWORD);
        expect(getMeta(opened.db, "initialized_at")).toBe("1000");

        const audit = listRecentAudit(opened.db);
        expect(audit[0]?.action).toBe("auth.init");
        expect(audit[0]?.detailsJson).not.toContain(PASSWORD);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects a repeated initialization with ALREADY_INITIALIZED", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        await applyInit({ db: opened.db, dataDir: dir, input: baseInput(), now: 1 });

        await expect(
          applyInit({ db: opened.db, dataDir: dir, input: baseInput({ port: 4000 }), now: 2 }),
        ).rejects.toMatchObject({ code: "ALREADY_INITIALIZED" });
      } finally {
        opened.close();
      }
    });
  });

  it("allows only one of two concurrent initializations", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const results = await Promise.allSettled([
          applyInit({ db: opened.db, dataDir: dir, input: baseInput(), now: 1 }),
          applyInit({ db: opened.db, dataDir: dir, input: baseInput(), now: 2 }),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected).toMatchObject({ reason: { code: "ALREADY_INITIALIZED" } });
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed when the audit write fails", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        opened.sqlite.exec("DROP TABLE audit_logs");

        await expect(
          applyInit({ db: opened.db, dataDir: dir, input: baseInput(), now: 1 }),
        ).rejects.toMatchObject({ code: "INTERNAL" });

        expect(getAuthSettings(opened.db)).toBeNull();
        await expect(stat(configFilePath(dir))).rejects.toThrow();
      } finally {
        opened.close();
      }
    });
  });

  it("flags restartRequired when listen settings differ", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const current = structuredClone(DEFAULT_APP_CONFIG);
        current.server.port = 9999;

        const result = await applyInit({
          db: opened.db,
          dataDir: dir,
          input: baseInput(),
          currentConfig: current,
          now: 1,
        });

        expect(result.restartRequired).toBe(true);
      } finally {
        opened.close();
      }
    });
  });
  it("preserves file settings without persisting unrelated environment overrides", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        const original = testConfig({
          server: { trustedProxies: ["127.0.0.1"] },
          auth: { idleTtlMinutes: 55 },
          logging: { level: "warn", retentionDays: 30 },
          updates: { channel: "beta", autoCheck: false },
          preview: { enabled: false },
        });
        await writeConfig(dir, original);
        const current = await loadConfig({ dataDir: dir, env: { LARNESS_LOG_LEVEL: "debug" } });
        const input = baseInput({ port: 4000 });
        delete (input as { channel?: string }).channel;
        await applyInit({ db: opened.db, dataDir: dir, input, currentConfig: current.config });
        const saved = (await loadConfig({ dataDir: dir, env: {} })).config;
        expect(saved.server.trustedProxies).toEqual(original.server.trustedProxies);
        expect(saved.auth).toEqual(original.auth);
        expect(saved.logging).toEqual(original.logging);
        expect(saved.updates).toEqual(original.updates);
        expect(saved.preview).toEqual(original.preview);
        expect(saved.server.port).toBe(4000);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the old file when the initialization transaction rolls back", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        await writeConfig(dir);
        const before = await readFile(configFilePath(dir), "utf8");
        opened.sqlite.exec(
          "CREATE TRIGGER fail_init BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END",
        );
        await expect(
          applyInit({ db: opened.db, dataDir: dir, input: baseInput({ port: 4000 }) }),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        expect(await readFile(configFilePath(dir), "utf8")).toBe(before);
        expect(getMeta(opened.db, "init_pending")).toBeNull();
        expect(isInitialized(opened.db)).toBe(false);
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed after publication failure and recovers committed configuration idempotently", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        // Model interruption immediately after COMMIT, before file publication.
        createAuthSettings(opened.db, { adminHash: "historical-hash", initializedAt: 1, now: 1 });
        setMeta(
          opened.db,
          "init_pending",
          JSON.stringify({ version: 1, config: testConfig({ server: { port: 4000 } }) }),
        );
        await mkdir(configFilePath(dir));
        expect(() => recoverInitialization(opened.db, dir)).toThrow();
        expect(getMeta(opened.db, "init_pending")).not.toBeNull();
        expect(isInitialized(opened.db)).toBe(false);
        await rm(configFilePath(dir), { recursive: true });
        expect(recoverInitialization(opened.db, dir)).toBe(true);
        expect((await loadConfig({ dataDir: dir, env: {} })).config.server.port).toBe(4000);
        expect(getMeta(opened.db, "init_pending")).toBeNull();
        expect(isInitialized(opened.db)).toBe(true);
        expect(recoverInitialization(opened.db, dir)).toBe(false);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects corrupt recovery records without replacing the config", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        await writeConfig(dir);
        const before = await readFile(configFilePath(dir), "utf8");
        setMeta(opened.db, "init_pending", '{"version":1,"config":{}}');
        expect(() => recoverInitialization(opened.db, dir)).toThrow(/initialization recovery/);
        expect(await readFile(configFilePath(dir), "utf8")).toBe(before);
        expect(getMeta(opened.db, "init_pending")).not.toBeNull();
      } finally {
        opened.close();
      }
    });
  });
  it("initializes without password and preserves historical hashes on repeat attempts", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      try {
        await applyInit({ db: opened.db, dataDir: dir, input: {} });
        expect(getAuthSettings(opened.db)?.adminHash).toBe("");
        opened.sqlite.prepare("UPDATE auth_settings SET admin_hash = ?").run("historical-hash");
        await expect(applyInit({ db: opened.db, dataDir: dir, input: {} })).rejects.toMatchObject({
          code: "ALREADY_INITIALIZED",
        });
        expect(getAuthSettings(opened.db)?.adminHash).toBe("historical-hash");
      } finally {
        opened.close();
      }
    });
  });

  it("does not persist effective environment values and computes restart from effective configuration", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);
      const env = {
        LARNESS_PORT: "4000",
        LARNESS_PUBLIC_URL: "https://custom.example",
        LARNESS_LOG_LEVEL: "debug",
      };
      try {
        const current = await loadConfig({ dataDir: dir, env });
        const result = await applyInit({
          db: opened.db,
          dataDir: dir,
          input: {},
          currentConfig: current.config,
          env,
        });
        expect(result).toMatchObject({ origin: "https://custom.example", restartRequired: false });
        const stored = await loadConfig({ dataDir: dir, env: {} });
        expect(stored.config.server.port).toBe(3210);
        expect(stored.config.server.publicUrl).toBeNull();
        expect(stored.config.logging.level).toBe("info");
      } finally {
        opened.close();
      }
    });
  });
});
