import { eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { appMeta } from "../schema.js";

export function getMeta(db: DbExecutor, key: string): string | null {
  const row = db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  return row?.value ?? null;
}

export function setMeta(db: DbExecutor, key: string, value: string, now = Date.now()): void {
  db.insert(appMeta)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: now } })
    .run();
}

export function ensureInstanceId(db: DbExecutor, now = Date.now()): string {
  const existing = getMeta(db, "instance_id");

  if (existing !== null) {
    return existing;
  }

  const instanceId = newId("inst");
  setMeta(db, "instance_id", instanceId, now);

  return instanceId;
}
