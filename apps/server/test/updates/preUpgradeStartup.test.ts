import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { openDatabase } from "../../src/db/client.js";
import { appliedMigrationCount, migrationsDirectory, runMigrations } from "../../src/db/migrate.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

function makePreviousMigrations(target: string): void {
  cpSync(migrationsDirectory(), target, { recursive: true });
  const journalPath = path.join(target, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const latest = journal.entries.at(-1)?.tag;
  journal.entries = journal.entries.filter((entry) => entry.tag !== latest);
  writeFileSync(journalPath, JSON.stringify(journal));
  if (latest !== undefined) rmSync(path.join(target, `${latest}.sql`), { force: true });
}

describe("pre-upgrade startup backup", () => {
  it("backs up a previous schema before running migrations", async () => {
    await withTempDir(async (dir) => {
      const dataDir = path.join(dir, "data");
      mkdirSync(dataDir, { recursive: true });
      const oldMigrations = path.join(dir, "old-drizzle");
      makePreviousMigrations(oldMigrations);

      const opened = openDatabase(path.join(dataDir, "larness.db"));
      try {
        runMigrations(opened.db, oldMigrations);
        expect(appliedMigrationCount(opened.sqlite)).toBe(22);
      } finally {
        opened.close();
      }

      const port = await getFreePort();
      const running = await startServer({
        env: {
          LARNESS_DATA_DIR: dataDir,
          LARNESS_PORT: String(port),
          LARNESS_SCHEDULER_ENABLED: "0",
        },
        logDestination: createLogSink().stream,
      });

      try {
        const backups = readdirSync(path.join(dataDir, "backups")).filter((entry) =>
          entry.startsWith("pre-upgrade-22-23-"),
        );
        expect(backups).toHaveLength(1);
      } finally {
        await running.shutdown("test");
      }
    });
  });
});
