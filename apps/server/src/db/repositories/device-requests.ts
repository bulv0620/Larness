import { desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type DeviceRequestRow, type DeviceRequestStatus, deviceRequests } from "../schema.js";

export interface CreateDeviceRequestInput {
  shortCode: string;
  pollTokenHash: string;
  createdAt: number;
  expiresAt: number;
  status?: DeviceRequestStatus;
  clientLabel?: string;
  userAgent?: string;
  ip?: string;
  clientOrigin?: string;
}

export function createDeviceRequest(
  db: DbExecutor,
  input: CreateDeviceRequestInput,
): DeviceRequestRow {
  const row: DeviceRequestRow = {
    id: newId("pair"),
    shortCode: input.shortCode,
    status: input.status ?? "pending",
    decision: null,
    clientLabel: input.clientLabel ?? null,
    userAgent: input.userAgent ?? null,
    ip: input.ip ?? null,
    clientOrigin: input.clientOrigin ?? null,
    pollTokenHash: input.pollTokenHash,
    codeHash: null,
    codeExpiresAt: null,
    attempts: 0,
    enrollmentTokenHash: null,
    enrollmentExpiresAt: null,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    decidedAt: null,
    redeemedAt: null,
  };

  db.insert(deviceRequests).values(row).run();

  return row;
}

export function getDeviceRequestById(db: DbExecutor, id: string): DeviceRequestRow | null {
  return db.select().from(deviceRequests).where(eq(deviceRequests.id, id)).get() ?? null;
}

export function getDeviceRequestByShortCode(
  db: DbExecutor,
  shortCode: string,
): DeviceRequestRow | null {
  return (
    db.select().from(deviceRequests).where(eq(deviceRequests.shortCode, shortCode)).get() ?? null
  );
}

export function listDeviceRequests(
  db: DbExecutor,
  status?: DeviceRequestRow["status"],
): DeviceRequestRow[] {
  if (status === undefined) {
    return db.select().from(deviceRequests).orderBy(desc(deviceRequests.createdAt)).all();
  }

  return db
    .select()
    .from(deviceRequests)
    .where(eq(deviceRequests.status, status))
    .orderBy(desc(deviceRequests.createdAt))
    .all();
}

export type DeviceRequestPatch = Partial<Omit<DeviceRequestRow, "id" | "shortCode" | "createdAt">>;

export function updateDeviceRequest(db: DbExecutor, id: string, patch: DeviceRequestPatch): void {
  if (Object.keys(patch).length === 0) {
    return;
  }

  db.update(deviceRequests).set(patch).where(eq(deviceRequests.id, id)).run();
}
