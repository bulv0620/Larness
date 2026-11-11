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

it("adds deployment authorizations and approvals without changing deployment plans", async () => {
  await withTempDir(async (dir) => {
    const migrations = path.join(dir, "migrations");
    await cp(migrationsDirectory(), migrations, { recursive: true });
    const journalPath = path.join(migrations, "meta", "_journal.json");
    const journal = Journal.parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 11);
    await writeFile(journalPath, JSON.stringify(journal));

    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(11);
      opened.sqlite
        .prepare("INSERT INTO resource_streams (stream_id, last_seq) VALUES (?, ?)")
        .run("file:project:fixture", 3);

      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(25);
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual([
        { stream_id: "file:project:fixture", last_seq: 3 },
      ]);
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('deployment_authorizations','deployment_approvals') ORDER BY name",
          )
          .all(),
      ).toEqual([{ name: "deployment_approvals" }, { name: "deployment_authorizations" }]);

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
      opened.sqlite
        .prepare(
          "INSERT INTO deployment_builds (id, target_id, project_id, request_key, requested_by, status, spec_json, spec_hash, reason_code, log_ref, started_at, ended_at, created_at) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', '{}', ?, NULL, ?, ?, ?, ?)",
        )
        .run(
          "bld_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "build-1",
          "client",
          hash,
          "logs/deploy/build.log",
          now,
          now,
          now,
        );
      opened.sqlite
        .prepare(
          "INSERT INTO deployment_artifacts (id, build_id, target_id, project_id, version, artifact_hash, artifact_path, size_bytes, file_count, spec_json, spec_hash, source_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, '{}', ?, '{}', ?)",
        )
        .run(
          "art_00000000-0000-4000-8000-000000000001",
          "bld_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "v1",
          hash,
          "tgt/art",
          hash,
          now,
        );
      opened.sqlite
        .prepare(
          "INSERT INTO deployment_plans (id, target_id, project_id, artifact_id, previous_artifact_id, previous_version, version, plan_json, plan_hash, status, expires_at, request_key, requested_by, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, '{}', ?, 'READY', ?, ?, ?, ?)",
        )
        .run(
          "plan_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "art_00000000-0000-4000-8000-000000000001",
          "v1",
          hash,
          now + 1000,
          "plan-1",
          "client",
          now,
        );

      const insertAuthorization = opened.sqlite.prepare(
        "INSERT INTO deployment_authorizations (id, plan_id, target_id, project_id, action, actor_type, actor_id, client_session_id, session_id, turn_id, policy, policy_snapshot_id, status, plan_hash, artifact_hash, scope_json, scope_hash, approval_id, request_key, expires_at, decided_at, consumed_at, consume_key, reason_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, '{}', ?, NULL, ?, ?, NULL, NULL, NULL, NULL, ?)",
      );
      insertAuthorization.run(
        "dauth_00000000-0000-4000-8000-000000000001",
        "plan_00000000-0000-4000-8000-000000000001",
        "tgt_00000000-0000-4000-8000-000000000001",
        "prj_fixture",
        "apply",
        "human",
        "client",
        "client",
        "autonomous",
        "psnap",
        "AUTHORIZED",
        hash,
        hash,
        hash,
        "auth-1",
        now + 1000,
        now,
      );
      expect(() =>
        insertAuthorization.run(
          "dauth_00000000-0000-4000-8000-000000000002",
          "plan_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "start",
          "human",
          "client",
          "client",
          "autonomous",
          "psnap",
          "AUTHORIZED",
          hash,
          hash,
          hash,
          "auth-2",
          now + 1000,
          now,
        ),
      ).toThrow(/CHECK/);
      expect(() =>
        insertAuthorization.run(
          "dauth_00000000-0000-4000-8000-000000000003",
          "plan_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          "apply",
          "human",
          "client",
          "client",
          "autonomous",
          "psnap",
          "AUTHORIZED",
          hash,
          hash,
          hash,
          "auth-1",
          now + 1000,
          now,
        ),
      ).toThrow(/UNIQUE/);

      const insertApproval = opened.sqlite.prepare(
        "INSERT INTO deployment_approvals (id, authorization_id, plan_id, target_id, project_id, status, plan_hash, artifact_hash, requested_by, decided_by, expires_at, decided_at, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, 'client', NULL, ?, NULL, ?)",
      );
      insertApproval.run(
        "dapv_00000000-0000-4000-8000-000000000001",
        "dauth_00000000-0000-4000-8000-000000000001",
        "plan_00000000-0000-4000-8000-000000000001",
        "tgt_00000000-0000-4000-8000-000000000001",
        "prj_fixture",
        hash,
        hash,
        now + 1000,
        now,
      );
      expect(() =>
        insertApproval.run(
          "dapv_00000000-0000-4000-8000-000000000002",
          "dauth_00000000-0000-4000-8000-000000000001",
          "plan_00000000-0000-4000-8000-000000000001",
          "tgt_00000000-0000-4000-8000-000000000001",
          "prj_fixture",
          hash,
          hash,
          now + 1000,
          now,
        ),
      ).toThrow(/UNIQUE/);
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.sqlite.close();
    }
  });
});
