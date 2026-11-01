import { and, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type BrowserSessionRow, browserSessions, type SessionKind } from "../schema.js";

export interface CreateBrowserSessionInput {
  tokenHash: string;
  kind: SessionKind;
  createdAt: number;
  expiresAt: number;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

export function createBrowserSession(
  db: DbExecutor,
  input: CreateBrowserSessionInput,
): BrowserSessionRow {
  const row: BrowserSessionRow = {
    id: newId("bs"),
    deviceId: input.deviceId ?? null,
    tokenHash: input.tokenHash,
    kind: input.kind,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    createdAt: input.createdAt,
    lastSeenAt: input.createdAt,
    expiresAt: input.expiresAt,
    revokedAt: null,
  };

  db.insert(browserSessions).values(row).run();

  return row;
}

export function getSessionByTokenHash(db: DbExecutor, tokenHash: string): BrowserSessionRow | null {
  return (
    db.select().from(browserSessions).where(eq(browserSessions.tokenHash, tokenHash)).get() ?? null
  );
}

export function listSessionsByDevice(db: DbExecutor, deviceId: string): BrowserSessionRow[] {
  return db.select().from(browserSessions).where(eq(browserSessions.deviceId, deviceId)).all();
}

export function touchSession(db: DbExecutor, id: string, lastSeenAt = Date.now()): void {
  db.update(browserSessions).set({ lastSeenAt }).where(eq(browserSessions.id, id)).run();
}

export function revokeSession(db: DbExecutor, id: string, now = Date.now()): boolean {
  return (
    db
      .update(browserSessions)
      .set({ revokedAt: now })
      .where(and(eq(browserSessions.id, id), isNull(browserSessions.revokedAt)))
      .run().changes > 0
  );
}

export function revokeDeviceSessions(db: DbExecutor, deviceId: string, now = Date.now()): number {
  return db
    .update(browserSessions)
    .set({ revokedAt: now })
    .where(and(eq(browserSessions.deviceId, deviceId), isNull(browserSessions.revokedAt)))
    .run().changes;
}
