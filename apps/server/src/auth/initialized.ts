import type { DbExecutor } from "../db/client.js";
import { getAuthSettings } from "../db/repositories/auth-settings.js";

export function isInitialized(db: DbExecutor): boolean {
  return getAuthSettings(db) !== null;
}
