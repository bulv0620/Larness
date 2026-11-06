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

it("adds formal service runtime records without changing authorization data", async () => {
  await withTempDir(async (dir) => {
    const migrations = path.join(dir, "migrations");
    await cp(migrationsDirectory(), migrations, { recursive: true });
    const journalPath = path.join(migrations, "meta", "_journal.json");
    const journal = Journal.parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 12);
    await writeFile(journalPath, JSON.stringify(journal));

    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(12);
      opened.sqlite
        .prepare("INSERT INTO resource_streams (stream_id, last_seq) VALUES (?, ?)")
        .run("ops:tgt_fixture", 2);

      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(14);
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual([
        { stream_id: "ops:tgt_fixture", last_seq: 2 },
      ]);
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('service_ops_services','service_ops_deployments') ORDER BY name",
          )
          .all(),
      ).toEqual([{ name: "service_ops_deployments" }, { name: "service_ops_services" }]);

      const now = 1;
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
      const insertService = opened.sqlite.prepare(
        "INSERT INTO service_ops_services (target_id, project_id, name, namespace, pm2_name, desired_state, observed_state, current_artifact_id, current_version, config_json, pid, last_health_at, reason_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, '{}', NULL, NULL, NULL, ?, ?)",
      );
      insertService.run(
        "tgt_00000000-0000-4000-8000-000000000001",
        "prj_fixture",
        "web",
        "larness",
        "larness-fixture",
        "running",
        "stopped",
        now,
        now,
      );
      expect(() =>
        insertService.run(
          "tgt_00000000-0000-4000-8000-000000000002",
          "prj_fixture",
          "api",
          "larness",
          "larness-api",
          "running",
          "bogus",
          now,
          now,
        ),
      ).toThrow(/CHECK|FOREIGN KEY/);
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.sqlite.close();
    }
  });
});
