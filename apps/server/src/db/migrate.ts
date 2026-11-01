import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { Database, OpenedDatabase } from "./client.js";

const SERVER_PACKAGE_NAME = "@larness/server";

export function findServerRoot(startDirectory: string): string {
  let directory = startDirectory;

  for (;;) {
    const packageFile = path.join(directory, "package.json");

    if (existsSync(packageFile)) {
      try {
        const parsed = JSON.parse(readFileSync(packageFile, "utf8")) as { name?: unknown };
        if (parsed.name === SERVER_PACKAGE_NAME) {
          return directory;
        }
      } catch {
        // Keep walking up from an unreadable package.json.
      }
    }

    const parent = path.dirname(directory);

    if (parent === directory) {
      throw new Error(`cannot locate the ${SERVER_PACKAGE_NAME} package root`);
    }

    directory = parent;
  }
}

export function migrationsDirectory(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  return path.join(findServerRoot(here), "drizzle");
}

export function runMigrations(db: Database, folder = migrationsDirectory()): void {
  if (!existsSync(path.join(folder, "meta", "_journal.json"))) {
    throw new Error(`migration directory is invalid or empty: ${folder}`);
  }

  migrate(db, { migrationsFolder: folder });
}

export function appliedMigrationCount(sqlite: OpenedDatabase["sqlite"]): number {
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
    )
    .get();

  if (table === undefined) {
    return 0;
  }

  const row = sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get() as
    | { count: number }
    | undefined;

  return row?.count ?? 0;
}

export function expectedMigrationCount(folder = migrationsDirectory()): number {
  const journalFile = path.join(folder, "meta", "_journal.json");

  try {
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries?: unknown[] };
    return journal.entries?.length ?? 0;
  } catch {
    return 0;
  }
}

export function quickCheck(sqlite: OpenedDatabase["sqlite"]): boolean {
  return sqlite.pragma("quick_check", { simple: true }) === "ok";
}
