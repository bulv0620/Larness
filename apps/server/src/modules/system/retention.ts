import { and, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import { agentEvents, sessionContextSummaries, sessions, turns } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { ACTIVE_TURN_STATUSES } from "../sessions/repository.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface RetentionWindow {
  events: number;
  turns: number;
  summaries: number;
}

export interface RetentionCleanupResult {
  dryRun: boolean;
  /** Sessions whose whole data segment is beyond the retention window. */
  sessions: number;
  events: number;
  turns: number;
  summaries: number;
  backupPath: string | null;
}

export interface RetentionCleanupOptions {
  db: Database;
  now?: number;
  retentionDays: RetentionWindow;
  deleteSessions: boolean;
  keepPinned: boolean;
  /** false = count only (default); true = delete after a successful backup. */
  execute?: boolean;
  /** Required when `execute` is true; must resolve to the backup file path. */
  backup?: () => Promise<string> | string;
}

/**
 * Session-level candidates: the whole conversation is older than the longest
 * retention window, has no active Turn, and is not pinned (ADR-058 decision 4).
 */
function candidateSessionIds(db: Database, options: RetentionCleanupOptions): string[] {
  const now = options.now ?? Date.now();
  const cutoff = now - Math.max(1, options.retentionDays.turns) * DAY_MS;
  const activeSessionIds = db
    .select({ sessionId: turns.sessionId })
    .from(turns)
    .where(inArray(turns.status, ACTIVE_TURN_STATUSES));

  const conditions = [lt(sessions.updatedAt, cutoff), notInArray(sessions.id, activeSessionIds)];

  if (options.keepPinned) {
    conditions.push(isNull(sessions.pinnedAt));
  }

  return db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(...conditions))
    .all()
    .map((row) => row.id);
}

function countFor(
  db: Database,
  table: typeof agentEvents | typeof turns | typeof sessionContextSummaries,
  ids: string[],
): number {
  if (ids.length === 0) {
    return 0;
  }

  return (
    db
      .select({ count: sql<number>`count(*)` })
      .from(table)
      .where(inArray(table.sessionId, ids))
      .get()?.count ?? 0
  );
}

/**
 * Deletes or counts retention-expired session data. Nothing is removed unless
 * `execute` is true AND the backup step succeeds; the whole deletion runs in one
 * transaction so a partial segment can never remain.
 */
export async function runRetentionCleanup(
  options: RetentionCleanupOptions,
): Promise<RetentionCleanupResult> {
  const now = options.now ?? Date.now();
  const ids = candidateSessionIds(options.db, options);
  const counts = {
    sessions: ids.length,
    events: countFor(options.db, agentEvents, ids),
    turns: countFor(options.db, turns, ids),
    summaries: countFor(options.db, sessionContextSummaries, ids),
  };

  if (options.execute !== true || ids.length === 0) {
    return { dryRun: true, ...counts, backupPath: null };
  }

  if (options.backup === undefined) {
    throw new Error("retention cleanup requires a backup before deleting data");
  }

  // A failed backup must abort the whole run; nothing is deleted.
  const backupPath = await options.backup();

  immediateTransaction(options.db, (tx) => {
    if (options.deleteSessions) {
      tx.delete(sessions).where(inArray(sessions.id, ids)).run();
    } else {
      tx.delete(agentEvents).where(inArray(agentEvents.sessionId, ids)).run();
      tx.delete(sessionContextSummaries)
        .where(inArray(sessionContextSummaries.sessionId, ids))
        .run();
      tx.delete(turns).where(inArray(turns.sessionId, ids)).run();
    }

    appendAudit(tx, {
      action: "storage.cleanup",
      decision: "allow",
      resourceType: "storage",
      resourceId: "retention",
      details: {
        dryRun: false,
        deleteSessions: options.deleteSessions,
        retentionDays: options.retentionDays,
        sessions: counts.sessions,
        events: counts.events,
        turns: counts.turns,
        summaries: counts.summaries,
        backupPath,
      },
      now,
    });
  });

  return { dryRun: false, ...counts, backupPath };
}
