import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { openDatabase } from "../../src/db/client.js";
import { appliedMigrationCount, migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { acquireResourceLock } from "../../src/modules/locks/service.js";
import { createProjectRow } from "../../src/modules/projects/repository.js";
import { withTempDir } from "../helpers.js";

it("upgrades v6 without changing projects, lock fencing or existing resource stream sequences", async () => {
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
    journal.entries = journal.entries.filter((entry) => entry.idx <= 6);
    await writeFile(journalPath, JSON.stringify(journal));
    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(6);
      const root = path.join(dir, "project");
      await mkdir(root);
      const project = createProjectRow(opened.db, {
        name: "Migration fixture",
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
        .run(`file:project:${project.id}`, 7);
      const previous = {
        streams: opened.sqlite.prepare("SELECT * FROM resource_streams").all(),
        project: opened.sqlite.prepare("SELECT * FROM projects").all(),
        locks: opened.sqlite.prepare("SELECT * FROM resource_locks").all(),
      };
      journal.entries = completeEntries.filter((entry) => entry.idx <= 7);
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(7);
      expect(opened.sqlite.prepare("SELECT * FROM projects").all()).toEqual(previous.project);
      expect(opened.sqlite.prepare("SELECT * FROM resource_locks").all()).toEqual(previous.locks);
      expect(opened.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get()).toEqual({
        n: 0,
      });
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual(
        previous.streams,
      );
      expect(opened.sqlite.prepare("SELECT count(*) AS n FROM terminals").get()).toEqual({ n: 0 });
      expect(opened.sqlite.prepare("SELECT count(*) AS n FROM terminal_leases").get()).toEqual({
        n: 0,
      });
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.close();
    }
  });
});

it("adds nullable terminal names to a populated v8 database without changing resources or leases", async () => {
  await withTempDir(async (dir) => {
    const old = path.join(dir, "v8");
    await cp(migrationsDirectory(), old, { recursive: true });
    const journalPath = path.join(old, "meta", "_journal.json");
    const journal = z
      .object({ entries: z.array(z.object({ idx: z.number() }).passthrough()) })
      .passthrough()
      .parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 8);
    await writeFile(journalPath, JSON.stringify(journal));
    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, old);
      opened.sqlite
        .prepare(
          "INSERT INTO resource_operations (id, scope_key, root_real_path, kind, status, params_hash, idempotency_key, client_session_id, path, expected_version, target_version, lock_id, fencing_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "op_1",
          "project:a",
          dir,
          "terminal.create",
          "COMPLETED",
          "hash",
          "key",
          "client",
          ".",
          "",
          "",
          "",
          7,
          1,
          1,
        );
      opened.sqlite
        .prepare(
          "INSERT INTO terminals (id, operation_id, project_id, cwd, shell, mode, status, created_at, output_cursor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run("term_legacy", "op_1", "project-a", dir, "/bin/sh", "shell", "EXITED", 1, 12);
      opened.sqlite
        .prepare(
          "INSERT INTO terminal_leases (terminal_id, generation, input_sequence) VALUES (?, ?, ?)",
        )
        .run("term_legacy", 8, 3);
      const before = opened.sqlite.prepare("SELECT * FROM terminals").get() as Record<
        string,
        unknown
      >;
      const leases = opened.sqlite.prepare("SELECT * FROM terminal_leases").all();
      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, old);
      expect(opened.sqlite.prepare("SELECT * FROM terminals").get()).toEqual({
        ...before,
        title: null,
      });
      expect(opened.sqlite.prepare("SELECT * FROM terminal_leases").all()).toEqual(leases);
      runMigrations(opened.db, old);
      expect(appliedMigrationCount(opened.sqlite)).toBe(19);
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.close();
    }
  });
});
