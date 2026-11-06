import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { openDatabase } from "../../src/db/client.js";
import { appliedMigrationCount, migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { acquireResourceLock } from "../../src/modules/locks/service.js";
import { createProjectRow } from "../../src/modules/projects/repository.js";
import { withTempDir } from "../helpers.js";

it("upgrades v7 with an empty resource_actions table and preserves projects, locks and streams", async () => {
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
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 7);
    await writeFile(journalPath, JSON.stringify(journal));
    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(7);
      const root = path.join(dir, "project");
      await mkdir(root);
      const project = createProjectRow(opened.db, {
        name: "Git migration fixture",
        rootPath: root,
        realPath: await realpath(root),
        settingsJson: '{"ignore":[]}',
        gitDetected: false,
        now: Date.now(),
      });
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
        .run(`git:${project.id}`, 3);
      const previous = {
        projects: opened.sqlite.prepare("SELECT * FROM projects").all(),
        locks: opened.sqlite.prepare("SELECT * FROM resource_locks").all(),
        streams: opened.sqlite.prepare("SELECT * FROM resource_streams").all(),
      };
      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(12);
      expect(opened.sqlite.prepare("SELECT * FROM projects").all()).toEqual(previous.projects);
      expect(opened.sqlite.prepare("SELECT * FROM resource_locks").all()).toEqual(previous.locks);
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual(
        previous.streams,
      );
      expect(opened.sqlite.prepare("SELECT count(*) AS n FROM resource_actions").get()).toEqual({
        n: 0,
      });
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.close();
    }
  });
});
