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

it("adds services without changing existing resource streams", async () => {
  await withTempDir(async (dir) => {
    const migrations = path.join(dir, "migrations");
    await cp(migrationsDirectory(), migrations, { recursive: true });
    const journalPath = path.join(migrations, "meta", "_journal.json");
    const journal = Journal.parse(JSON.parse(await readFile(journalPath, "utf8")));
    const complete = journal.entries;
    journal.entries = complete.filter((entry) => entry.idx <= 9);
    await writeFile(journalPath, JSON.stringify(journal));

    const opened = openDatabase(path.join(dir, "db"));
    try {
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(9);
      opened.sqlite
        .prepare("INSERT INTO resource_streams (stream_id, last_seq) VALUES (?, ?)")
        .run("file:project:fixture", 3);

      journal.entries = complete;
      await writeFile(journalPath, JSON.stringify(journal));
      runMigrations(opened.db, migrations);
      expect(appliedMigrationCount(opened.sqlite)).toBe(14);
      expect(opened.sqlite.prepare("SELECT * FROM resource_streams").all()).toEqual([
        { stream_id: "file:project:fixture", last_seq: 3 },
      ]);
      expect(
        opened.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'services'")
          .get(),
      ).toEqual({ name: "services" });
      expect(
        opened.sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'services_active_endpoint'",
          )
          .get(),
      ).toEqual({ name: "services_active_endpoint" });
      expect(opened.sqlite.pragma("foreign_key_check")).toEqual([]);
    } finally {
      opened.sqlite.close();
    }
  });
});
