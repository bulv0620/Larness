import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import { browserSessions, deviceRequests } from "./schema.js";

export function countOnlineSessions(db: DbExecutor, now = Date.now()): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(browserSessions)
    .where(and(isNull(browserSessions.revokedAt), gt(browserSessions.expiresAt, now)))
    .get();

  return row?.count ?? 0;
}

export function countPendingPairings(db: DbExecutor): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(deviceRequests)
    .where(eq(deviceRequests.status, "pending"))
    .get();

  return row?.count ?? 0;
}
