import { cp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backupDatabase } from "../../src/db/backup.js";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import {
  appliedMigrationCount,
  migrationsDirectory,
  quickCheck,
  runMigrations,
} from "../../src/db/migrate.js";
import { withTempDir } from "../helpers.js";

async function openMigrated(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("migrations", () => {
  it("migrates an empty database and enables WAL and foreign keys", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        expect(opened.sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
        expect(opened.sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
        expect(opened.sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
        expect(quickCheck(opened.sqlite)).toBe(true);
        expect(appliedMigrationCount(opened.sqlite)).toBe(32);

        const sessionColumns = opened.sqlite.prepare("PRAGMA table_info(sessions)").all() as {
          name: string;
        }[];
        expect(sessionColumns.map((column) => column.name)).toContain("origin");

        const tables = opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
          )
          .all() as { name: string }[];
        const names = tables.map((table) => table.name);

        expect(names).toEqual(
          expect.arrayContaining([
            "app_meta",
            "auth_settings",
            "device_requests",
            "trusted_devices",
            "webauthn_credentials",
            "webauthn_challenges",
            "browser_sessions",
            "audit_logs",
            "sessions",
            "turns",
            "agent_events",
            "approvals",
            "resource_locks",
            "secrets",
            "credential_profiles",
            "model_profiles",
            "command_executions",
            "terminals",
            "terminal_leases",
            "resource_actions",
            "deployment_targets",
            "deployment_builds",
            "deployment_artifacts",
            "deployment_plans",
            "deployment_authorizations",
            "deployment_approvals",
            "service_ops_services",
            "service_ops_deployments",
            "service_action_authorizations",
            "scheduled_jobs",
            "scheduled_job_runs",
          ]),
        );

        if (process.platform !== "win32") {
          expect((await stat(opened.path)).mode & 0o777).toBe(0o600);
        }
      } finally {
        opened.close();
      }
    });
  });

  it("preserves existing model selections and keeps old turns readable", async () => {
    await withTempDir(async (dir) => {
      const migrations = path.join(dir, "migrations");
      await cp(migrationsDirectory(), migrations, { recursive: true });
      const journalPath = path.join(migrations, "meta", "_journal.json");
      const journalText = await readFile(journalPath, "utf8");
      const journal = JSON.parse(journalText) as { entries: unknown[] };
      await writeFile(
        journalPath,
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, -5) }),
      );
      const { db, sqlite, close } = openDatabase(path.join(dir, "larness.db"));
      try {
        runMigrations(db, migrations);
        expect(appliedMigrationCount(sqlite)).toBe(27);
        sqlite.exec(`
          INSERT INTO secrets VALUES ('sec_old', 'ciphertext', 'nonce', 'tag', 1);
          INSERT INTO credential_profiles
            (id, provider, label, secret_ref, endpoint, created_at)
            VALUES ('cred_old', 'glm', 'Coding', 'sec_old', 'https://api.z.ai/api/coding/paas/v4', 1);
          INSERT INTO model_defaults VALUES ('default', 'cred_old', 'glm-4.6', 'on', 1);
          INSERT INTO model_visibility VALUES ('mv_old', 'cred_old', 'glm-4.7', 0, 1);
          INSERT INTO sessions
            (id, workspace_path, title, created_at, updated_at, last_activity_at, credential_profile_id, model)
            VALUES ('ses_old', '/fixture', 'Example', 1, 1, 1, 'cred_old', 'glm-4.6');
          INSERT INTO turns
            (id, session_id, status, input_json, created_at, credential_profile_id, provider, model)
            VALUES ('trn_old', 'ses_old', 'COMPLETED', '{}', 1, 'cred_old', 'glm', 'glm-4.6');
        `);
        await writeFile(journalPath, journalText);
        runMigrations(db, migrations);
        expect(sqlite.prepare("SELECT * FROM credential_profiles").get()).toMatchObject({
          id: "cred_old",
          revision: 1,
          secret_ref: "sec_old",
          endpoint: "https://api.z.ai/api/coding/paas/v4",
        });
        expect(sqlite.prepare("SELECT * FROM model_defaults").get()).toMatchObject({
          credential_profile_id: "cred_old",
          model: "glm-4.6",
          thinking: "on",
        });
        expect(sqlite.prepare("SELECT * FROM model_visibility").get()).toMatchObject({
          credential_profile_id: "cred_old",
          model_id: "glm-4.7",
          visible: 0,
        });
        expect(sqlite.prepare("SELECT * FROM sessions").get()).toMatchObject({
          credential_profile_id: "cred_old",
          model: "glm-4.6",
        });
        expect(sqlite.prepare("SELECT * FROM turns").get()).toMatchObject({
          credential_profile_id: "cred_old",
          provider: "glm",
          model: "glm-4.6",
          connection_revision: null,
        });
      } finally {
        close();
      }
    });
  });

  it("is idempotent when run again", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        runMigrations(opened.db);
        expect(appliedMigrationCount(opened.sqlite)).toBe(32);
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed on an invalid migration directory", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));

      try {
        expect(() => runMigrations(opened.db, path.join(dir, "missing"))).toThrow(
          /migration directory is invalid/,
        );
        expect(appliedMigrationCount(opened.sqlite)).toBe(0);
      } finally {
        opened.close();
      }
    });
  });

  it("exposes no long-term device token column", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const columns = opened.sqlite.prepare("PRAGMA table_info(trusted_devices)").all() as {
          name: string;
        }[];
        expect(columns.map((column) => column.name)).not.toContain("token");
        expect(columns.map((column) => column.name)).not.toContain("device_token");
      } finally {
        opened.close();
      }
    });
  });

  it("rejects duplicate credential IDs and unknown devices", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        opened.sqlite
          .prepare("INSERT INTO trusted_devices (id, label, created_at) VALUES (?, ?, ?)")
          .run("dev_1", "Test", 1);

        opened.sqlite
          .prepare(
            "INSERT INTO webauthn_credentials (id, device_id, credential_id, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run("cred_1", "dev_1", "credential-1", "cose", 1);

        expect(() =>
          opened.sqlite
            .prepare(
              "INSERT INTO webauthn_credentials (id, device_id, credential_id, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run("cred_2", "dev_1", "credential-1", "cose", 1),
        ).toThrow(/UNIQUE/);

        expect(() =>
          opened.sqlite
            .prepare(
              "INSERT INTO webauthn_credentials (id, device_id, credential_id, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
            )
            .run("cred_3", "dev_missing", "credential-3", "cose", 1),
        ).toThrow(/FOREIGN KEY/);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects duplicate session token hashes", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        opened.sqlite
          .prepare(
            "INSERT INTO browser_sessions (id, token_hash, kind, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run("bs_1", "hash-1", "once", 1, 1, 2);

        expect(() =>
          opened.sqlite
            .prepare(
              "INSERT INTO browser_sessions (id, token_hash, kind, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run("bs_2", "hash-1", "once", 1, 1, 2),
        ).toThrow(/UNIQUE/);
      } finally {
        opened.close();
      }
    });
  });

  it("creates a consistent backup copy", async () => {
    await withTempDir(async (dir) => {
      const opened = await openMigrated(dir);

      try {
        const target = backupDatabase(opened.sqlite, path.join(dir, "backups"), 1761900000000);
        expect(path.basename(target)).toMatch(/^larness-.*\.db$/);

        const copy = openDatabase(target);

        try {
          expect(appliedMigrationCount(copy.sqlite)).toBe(32);
        } finally {
          copy.close();
        }
      } finally {
        opened.close();
      }
    });
  });

  it("treats a corrupt database file as a startup error", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "larness.db");
      await writeFile(file, "not a database");

      expect(() => openDatabase(file)).toThrow();
    });
  });
});
