import { chmodSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

type SqliteDatabase = ReturnType<typeof createSqlite>;

function createSqlite(file: string): BetterSqlite3.Database {
  return new BetterSqlite3(file);
}

export type Database = BetterSQLite3Database<typeof schema>;

export interface OpenedDatabase {
  db: Database;
  sqlite: SqliteDatabase;
  path: string;
  close(): void;
}

export function openDatabase(file: string): OpenedDatabase {
  const sqlite = createSqlite(file);

  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("synchronous = NORMAL");

    if (process.platform !== "win32") {
      chmodSync(file, 0o600);
    }
  } catch (error) {
    sqlite.close();
    throw error;
  }

  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    path: file,
    close: () => sqlite.close(),
  };
}

export type DbExecutor = Pick<Database, "select" | "insert" | "update" | "delete">;
