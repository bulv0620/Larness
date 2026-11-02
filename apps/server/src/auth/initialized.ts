import type { DbExecutor } from "../db/client.js";
import { getAuthSettings } from "../db/repositories/auth-settings.js";
import { getMeta } from "../db/repositories/meta.js";

export function isInitialized(db: DbExecutor): boolean {
  return getAuthSettings(db) !== null && getMeta(db, "init_pending") === null;
}
