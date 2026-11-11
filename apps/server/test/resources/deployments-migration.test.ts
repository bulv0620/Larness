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

it("adds deployment targets, builds, artifacts and plans without changing existing data", async () => {
  await withTempDir(async (dir) => {
    const migrations = path.join(dir, "migrations");
    await cp(migrationsDirectory(), migrations, { recursive: true });
    const journalPath = path.join(migrations, "meta", "_journal.json");
    const journal = Journal.parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 10);
    await writeFile(journalPath, JSON.stringify(journal));

    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(10);
      opened.sqlite
        .prepare(
          "INSERT INTO projects (id, name, root_path, real_path, settings_json, git_detected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .run("prj_fixture", "Fixture", "/tmp/fixture", "/tmp/fixture", "{}", 1, 1);
      opened.sqlite
        .prepare("INSERT INTO resource_streams (stream_id, last_seq) VALUES (?, ?)")
        .run("file:project:fixture", 3);

      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(26);
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual([
        { stream_id: "file:project:fixture", last_seq: 3 },
      ]);
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('deployment_targets','deployment_builds','deployment_artifacts','deployment_plans') ORDER BY name",
          )
          .all(),
      ).toEqual([
        { name: "deployment_artifacts" },
        { name: "deployment_builds" },
        { name: "deployment_plans" },
        { name: "deployment_targets" },
      ]);
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'deployment_artifacts_target_version'",
          )
          .get(),
      ).toEqual({ name: "deployment_artifacts_target_version" });

      const insertTarget = opened.sqlite.prepare(
        "INSERT INTO deployment_targets (id, project_id, name, current_artifact_id, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insertTarget.run(
        "tgt_00000000-0000-4000-8000-000000000001",
        "prj_fixture",
        "web",
        null,
        null,
        1,
        1,
      );
      expect(() =>
        insertTarget.run(
          "tgt_00000000-0000-4000-8000-000000000002",
          "prj_fixture",
          "web",
          null,
          null,
          1,
          1,
        ),
      ).toThrow(/UNIQUE/);
      expect(() =>
        insertTarget.run(
          "tgt_00000000-0000-4000-8000-000000000003",
          "prj_fixture",
          "api",
          null,
          "v1",
          1,
          1,
        ),
      ).toThrow(/CHECK/);
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.sqlite.close();
    }
  });
});
