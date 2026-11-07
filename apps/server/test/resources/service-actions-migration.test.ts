import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { openDatabase } from "../../src/db/client.js";
import { appliedMigrationCount, migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { withTempDir } from "../helpers.js";

const Journal = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(
    z.object({
      idx: z.number(),
      version: z.string(),
      when: z.number(),
      tag: z.string(),
      breakpoints: z.boolean(),
    }),
  ),
});

it("adds service action authorizations without changing service runtime records", async () => {
  await withTempDir(async (dir) => {
    const migrations = path.join(dir, "migrations");
    await cp(migrationsDirectory(), migrations, { recursive: true });
    const journalPath = path.join(migrations, "meta", "_journal.json");
    const journal = Journal.parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 13);
    await writeFile(journalPath, JSON.stringify(journal));

    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(13);
      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(16);
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'service_action_authorizations'",
          )
          .get(),
      ).toEqual({ name: "service_action_authorizations" });

      const now = 1;
      const hash = "0".repeat(64);
      opened.sqlite
        .prepare(
          "INSERT INTO projects (id, name, root_path, real_path, settings_json, git_detected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .run("prj_fixture", "Fixture", "/tmp/fixture", "/tmp/fixture", "{}", now, now);
      opened.sqlite
        .prepare(
          "INSERT INTO deployment_targets (id, project_id, name, current_artifact_id, current_version, created_at, updated_at) VALUES (?, ?, ?, NULL, NULL, ?, ?)",
        )
        .run("tgt_00000000-0000-4000-8000-000000000001", "prj_fixture", "web", now, now);
      const insert = opened.sqlite.prepare(
        "INSERT INTO service_action_authorizations (id, target_id, project_id, action, actor_type, actor_id, client_session_id, session_id, turn_id, policy, policy_snapshot_id, status, artifact_hash, version, scope_json, scope_hash, request_key, expires_at, decided_at, decided_by, consumed_at, consume_key, reason_code, created_at) VALUES (?, ?, ?, ?, 'human', 'client', 'client', NULL, NULL, 'autonomous', 'psnap', 'AUTHORIZED', ?, 'v1', '{}', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)",
      );
      insert.run(
        "sauth_00000000-0000-4000-8000-000000000001",
        "tgt_00000000-0000-4000-8000-000000000001",
        "prj_fixture",
        "start",
        hash,
        hash,
        "action-1",
        now + 1000,
        now,
        now,
      );
      expect(() =>
        insert.run(
          "sauth_00000000-0000-4000-8000-000000000002",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "apply",
          hash,
          hash,
          "action-2",
          now + 1000,
          now,
          now,
        ),
      ).toThrow(/CHECK/);
      expect(() =>
        insert.run(
          "sauth_00000000-0000-4000-8000-000000000003",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "start",
          hash,
          hash,
          "action-1",
          now + 1000,
          now,
          now,
        ),
      ).toThrow(/UNIQUE/);
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.sqlite.close();
    }
  });
});
