import { cp, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashContent } from "@larness/resources";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { projects, resourceLocks, resourceOperations } from "../../src/db/schema.js";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { reconcileFileOperations, saveFile } from "../../src/modules/files/service.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";

describe("file operation durability", () => {
  it("fails closed before disk IO if write intent persistence fails", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "data"));
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "file"), "original");
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        const project = await createProject({ db: opened.db }, { rootPath: root });
        opened.sqlite.exec(
          "CREATE TRIGGER reject_intent BEFORE INSERT ON resource_operations BEGIN SELECT RAISE(FAIL, 'fixture-storage-failure'); END",
        );
        await expect(
          saveFile(
            { db: opened.db, dataDir: path.join(dir, "data") },
            {
              scope: { projectId: project.id },
              path: "file",
              content: "new",
              expectedVersion: hashContent(Buffer.from("original")),
            },
            "client",
            "key",
          ),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        expect(await readFile(path.join(root, "file"), "utf8")).toBe("original");
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM resource_events").get()).toEqual({
          n: 0,
        });
        expect(
          opened.sqlite
            .prepare("SELECT count(*) AS n FROM resource_locks WHERE expires_at > 0")
            .get(),
        ).toEqual({ n: 0 });
      } finally {
        opened.close();
      }
    });
  });

  it("blocks uncertain writes, recovers committed bytes after DB reopen, and replays once", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "data"));
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "file"), "original");
      const dbPath = path.join(dir, "db");
      let opened = openDatabase(dbPath);
      runMigrations(opened.db);
      try {
        const project = await createProject({ db: opened.db }, { rootPath: root });
        const input = {
          scope: { projectId: project.id },
          path: "file",
          content: "committed",
          expectedVersion: hashContent(Buffer.from("original")),
        };
        opened.sqlite.exec(
          "CREATE TRIGGER reject_result BEFORE INSERT ON resource_events BEGIN SELECT RAISE(FAIL, 'fixture-result-failure'); END",
        );
        await expect(
          saveFile({ db: opened.db, dataDir: path.join(dir, "data") }, input, "client", "key"),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        expect(await readFile(path.join(root, "file"), "utf8")).toBe("committed");
        expect(opened.db.select().from(resourceOperations).get()).toMatchObject({
          status: "RECONCILIATION_REQUIRED",
        });
        const operation = opened.db.select().from(resourceOperations).get();
        expect(operation).toBeDefined();
        const temporary = path.join(root, `.larness-save-${operation?.id}`);
        await writeFile(temporary, "committed");
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM resource_events").get()).toEqual({
          n: 0,
        });
        expect(
          new ProjectWriteLock({
            db: opened.db,
            projectId: project.id,
            owner: "other",
            executionId: "other",
          }).acquire(),
        ).toBeNull();
        opened.sqlite.exec("DROP TRIGGER reject_result");
        opened.close();
        opened = openDatabase(dbPath);
        await reconcileFileOperations({ db: opened.db, dataDir: path.join(dir, "data") });
        await reconcileFileOperations({ db: opened.db, dataDir: path.join(dir, "data") });
        await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" });
        const result = await saveFile(
          { db: opened.db, dataDir: path.join(dir, "data") },
          input,
          "client",
          "key",
        );
        expect(result.version).toBe(hashContent(Buffer.from("committed")));
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM resource_events").get()).toEqual({
          n: 1,
        });
        expect(opened.sqlite.prepare("SELECT last_seq FROM resource_streams").get()).toEqual({
          last_seq: 1,
        });
        const next = new ProjectWriteLock({
          db: opened.db,
          projectId: project.id,
          owner: "other",
          executionId: "other",
        });
        expect(next.acquire()).not.toBeNull();
        next.release();
      } finally {
        opened.close();
      }
    });
  });

  it("never overwrites external changes while reconciling a failed result", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "data"));
      const root = path.join(dir, "project");
      await mkdir(root);
      const file = path.join(root, "file");
      await writeFile(file, "original");
      const opened = openDatabase(path.join(dir, "db"));
      runMigrations(opened.db);
      try {
        const project = await createProject({ db: opened.db }, { rootPath: root });
        opened.sqlite.exec(
          "CREATE TRIGGER reject_result BEFORE INSERT ON resource_events BEGIN SELECT RAISE(FAIL, 'fixture-result-failure'); END",
        );
        await expect(
          saveFile(
            { db: opened.db, dataDir: path.join(dir, "data") },
            {
              scope: { projectId: project.id },
              path: "file",
              content: "new",
              expectedVersion: hashContent(Buffer.from("original")),
            },
            "client",
            "key",
          ),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        opened.sqlite.exec("DROP TRIGGER reject_result");
        await writeFile(file, "external");
        await reconcileFileOperations({ db: opened.db, dataDir: path.join(dir, "data") });
        expect(await readFile(file, "utf8")).toBe("external");
        expect(opened.db.select().from(resourceOperations).get()).toMatchObject({
          status: "RECONCILIATION_REQUIRED",
        });
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM resource_events").get()).toEqual({
          n: 0,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("upgrades a v4 database without losing projects and maps existing locks to canonical roots", async () => {
    await withTempDir(async (dir) => {
      const migrationRoot = path.join(dir, "migrations");
      await cp(migrationsDirectory(), migrationRoot, { recursive: true });
      const journalPath = path.join(migrationRoot, "meta", "_journal.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 4);
      await writeFile(journalPath, JSON.stringify(journal));
      const opened = openDatabase(path.join(dir, "db"));
      try {
        runMigrations(opened.db, migrationRoot);
        const root = await realpath(dir);
        opened.sqlite
          .prepare(
            "INSERT INTO projects (id,name,root_path,real_path,settings_json,git_detected,created_at,updated_at) VALUES ('prj_existing','Existing',?,?,'{}',0,1,1)",
          )
          .run(root, root);
        opened.sqlite
          .prepare(
            "INSERT INTO resource_locks (id,resource_type,resource_id,owner,execution_id,fencing_token,expires_at,heartbeat_at,created_at) VALUES ('lck_existing','project','prj_existing','old','old',7,9999999999999,1,1)",
          )
          .run();
        runMigrations(opened.db);
        expect(
          opened.db.select().from(projects).where(eq(projects.id, "prj_existing")).get(),
        ).toMatchObject({ name: "Existing" });
        expect(opened.db.select().from(resourceLocks).get()).toMatchObject({
          rootRealPath: root,
          fencingToken: 7,
        });
        expect(
          new ProjectWriteLock({
            db: opened.db,
            projectId: "prj_existing",
            executionId: "new",
            owner: "new",
          }).acquire(),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });
});
