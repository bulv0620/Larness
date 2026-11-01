import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { type AuthSettingsRow, authSettings } from "../schema.js";

export interface CreateAuthSettingsInput {
  adminHash: string;
  initializedAt: number;
  now: number;
}

export function getAuthSettings(db: DbExecutor): AuthSettingsRow | null {
  return db.select().from(authSettings).where(eq(authSettings.id, 1)).get() ?? null;
}

export function createAuthSettings(
  db: DbExecutor,
  input: CreateAuthSettingsInput,
): AuthSettingsRow {
  const row: AuthSettingsRow = {
    id: 1,
    adminHash: input.adminHash,
    adminUpdatedAt: input.now,
    initializedAt: input.initializedAt,
  };

  db.insert(authSettings).values(row).run();

  return row;
}

export function updateAdminHash(db: DbExecutor, adminHash: string, now = Date.now()): void {
  db.update(authSettings)
    .set({ adminHash, adminUpdatedAt: now })
    .where(eq(authSettings.id, 1))
    .run();
}
