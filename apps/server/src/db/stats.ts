import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import type { DbExecutor } from "./client.js";
import { browserSessions, deviceRequests } from "./schema.js";

/**
 * Sessions that still pass `resolveActiveSession`: not revoked, not absolutely
 * expired, and seen within the idle TTL. Counting expired rows made the TUI
 * report browsers as online for the full session TTL after they were closed.
 */
export function countOnlineSessions(db: DbExecutor, now: number, idleTtlMinutes: number): number {
  const idleCutoff = now - idleTtlMinutes * 60_000;
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(browserSessions)
    .where(
      and(
        isNull(browserSessions.revokedAt),
        gt(browserSessions.expiresAt, now),
        gte(browserSessions.lastSeenAt, idleCutoff),
      ),
    )
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
