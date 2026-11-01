import { existsSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { appliedMigrationCount, quickCheck } from "./migrate.js";

export interface DatabaseInspection {
  ok: boolean;
  schemaVersion: number;
  detail: string;
}

export function inspectDatabase(file: string): DatabaseInspection | null {
  if (!existsSync(file)) {
    return null;
  }

  let sqlite: BetterSqlite3.Database | null = null;

  try {
    sqlite = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
    const schemaVersion = appliedMigrationCount(sqlite);
    const ok = quickCheck(sqlite);

    return {
      ok,
      schemaVersion,
      detail: ok ? "quick_check ok" : "quick_check failed",
    };
  } catch (error) {
    return {
      ok: false,
      schemaVersion: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    sqlite?.close();
  }
}
