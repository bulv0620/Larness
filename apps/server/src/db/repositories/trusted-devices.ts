import { desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type TrustedDeviceRow, trustedDevices } from "../schema.js";

export interface CreateTrustedDeviceInput {
  label: string;
  createdAt: number;
  createdByRequestId?: string;
  userAgent?: string;
}

export function createTrustedDevice(
  db: DbExecutor,
  input: CreateTrustedDeviceInput,
): TrustedDeviceRow {
  const row: TrustedDeviceRow = {
    id: newId("dev"),
    label: input.label,
    createdByRequestId: input.createdByRequestId ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: input.createdAt,
    lastSeenAt: null,
    revokedAt: null,
  };

  db.insert(trustedDevices).values(row).run();

  return row;
}

export function getTrustedDevice(db: DbExecutor, id: string): TrustedDeviceRow | null {
  return db.select().from(trustedDevices).where(eq(trustedDevices.id, id)).get() ?? null;
}

export function listTrustedDevices(db: DbExecutor, includeRevoked = false): TrustedDeviceRow[] {
  if (includeRevoked) {
    return db.select().from(trustedDevices).orderBy(desc(trustedDevices.createdAt)).all();
  }

  return db
    .select()
    .from(trustedDevices)
    .where(isNull(trustedDevices.revokedAt))
    .orderBy(desc(trustedDevices.createdAt))
    .all();
}

export function revokeTrustedDevice(db: DbExecutor, id: string, now = Date.now()): boolean {
  return (
    db.update(trustedDevices).set({ revokedAt: now }).where(eq(trustedDevices.id, id)).run()
      .changes > 0
  );
}
