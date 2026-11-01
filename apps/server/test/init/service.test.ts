import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APP_CONFIG } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { configFilePath } from "../../src/bootstrap/config.js";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { getAuthSettings } from "../../src/db/repositories/auth-settings.js";
import { getMeta } from "../../src/db/repositories/meta.js";
import { validateAdminPassword } from "../../src/init/password.js";
import { applyInit, buildInitConfig, InitError } from "../../src/init/service.js";
import { withTempDir } from "../helpers.js";

const PASSWORD = "correct horse battery staple";

async function openMigrated(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function baseInput(overrides: Partial<Parameters<typeof buildInitConfig>[0]> = {}) {
  return {
    adminPassword: PASSWORD,
    host: "127.0.0.1",
    port: 3210,
    publicUrl: null,
    channel: "stable" as const,
    ...overrides,
  };
}

describe("admin password policy", () => {
  it("requires at least 12 non-whitespace characters", () => {
    expect(validateAdminPassword("short")).toBeTruthy();
    expect(validateAdminPassword("            ")).toBeTruthy();
    expect(validateAdminPassword(PASSWORD)).toBeNull();
  });
});

describe("buildInitConfig", () => {
  it("rejects short passwords and invalid public URLs", () => {
    expect(() => buildInitConfig(baseInput({ adminPassword: "short" }))).toThrow(InitError);
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
          webauthn: { origin: string; rpId: string };
        };
        expect(config.server).toMatchObject({ host: "127.0.0.1", port: 3210 });
        expect(config.webauthn).toMatchObject({
          origin: "http://localhost:3210",
          rpId: "localhost",
        });

        expect(getAuthSettings(opened.db)?.adminHash).toMatch(/^\$argon2id\$/);
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
});
