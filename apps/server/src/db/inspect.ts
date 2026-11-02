import { existsSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";
import { InitPendingSchema } from "../init/recovery.js";
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
    const pending = sqlite.prepare("SELECT value FROM app_meta WHERE key = ?").get("init_pending");
    return (row?.count ?? 0) > 0 && pending === undefined;
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

// Read-only planning for the supervisor. Only the locked server publishes it.
export function inspectPendingInitialization(file: string) {
  if (!existsSync(file)) return null;
  const sqlite = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
  try {
    if (
      !sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'")
        .get()
    )
      return null;
    const row = sqlite.prepare("SELECT value FROM app_meta WHERE key = ?").get("init_pending") as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return InitPendingSchema.parse(JSON.parse(row.value)).config;
    } catch {
      throw new Error("invalid initialization recovery record; restore the database backup");
    }
  } finally {
    sqlite.close();
  }
}
