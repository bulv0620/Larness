import { existsSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { appliedMigrationCount, quickCheck } from "./migrate.js";

export interface DatabaseInspection {
  ok: boolean;
  schemaVersion: number;
  initialized: boolean;
  detail: string;
}

function hasAuthSettings(sqlite: BetterSqlite3.Database): boolean {
  try {
    const row = sqlite.prepare("SELECT count(*) AS count FROM auth_settings").get() as
      | { count: number }
      | undefined;
    return (row?.count ?? 0) > 0;
  } catch {
    return false;
  }
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
    const initialized = hasAuthSettings(sqlite);

    return {
      ok,
      schemaVersion,
      initialized,
      detail: ok ? "quick_check ok" : "quick_check failed",
    };
  } catch (error) {
    return {
      ok: false,
      schemaVersion: 0,
      initialized: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    sqlite?.close();
  }
}
