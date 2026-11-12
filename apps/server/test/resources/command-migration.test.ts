import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { openDatabase } from "../../src/db/client.js";
import { appliedMigrationCount, migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { acquireResourceLock } from "../../src/modules/locks/service.js";
import { withTempDir } from "../helpers.js";

it("upgrades v5 without changing projects, lock fencing or existing resource stream sequences", async () => {
  await withTempDir(async (dir) => {
    const old = path.join(dir, "old-migrations");
    await cp(migrationsDirectory(), old, { recursive: true });
    const journalPath = path.join(old, "meta", "_journal.json");
    const journal = z
      .object({
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
      })
      .parse(JSON.parse(await readFile(journalPath, "utf8")));
    const completeEntries = journal.entries;
    journal.entries = journal.entries.filter((entry) => entry.idx <= 5);
    await writeFile(journalPath, JSON.stringify(journal));
    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(5);
      const root = path.join(dir, "project");
      await mkdir(root);
      const realPath = await realpath(root);
      const project = { id: "prj_migration_fixture", realPath };
      const now = Date.now();
      opened.sqlite
        .prepare(
          "INSERT INTO projects (id, name, root_path, real_path, settings_json, git_detected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
        )
        .run(project.id, "Migration fixture", root, realPath, '{"ignore":[]}', now, now);
      acquireResourceLock(
        { db: opened.db },
        {
          resourceType: "project",
          resourceId: project.id,
          rootRealPath: project.realPath,
          owner: "fixture",
          executionId: "fixture",
          ttlMs: 1000,
        },
      );
      opened.sqlite
        .prepare("INSERT INTO resource_streams (stream_id, last_seq) VALUES (?, ?)")
        .run(`file:project:${project.id}`, 7);
      const previous = {
        streams: opened.sqlite.prepare("SELECT * FROM resource_streams").all(),
        project: opened.sqlite.prepare("SELECT * FROM projects").all(),
        locks: opened.sqlite.prepare("SELECT * FROM resource_locks").all(),
      };
      journal.entries = completeEntries.filter((entry) => entry.idx <= 6);
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(6);
      expect(opened.sqlite.prepare("SELECT * FROM projects").all()).toEqual(previous.project);
      expect(opened.sqlite.prepare("SELECT * FROM resource_locks").all()).toEqual(previous.locks);
      expect(opened.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get()).toEqual({
        n: 0,
      });
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual(
        previous.streams,
      );
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.close();
    }
  });
});
