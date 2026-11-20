import { and, eq, inArray, lt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { memories, memoryRevisions, memorySuppressions } from "../../db/schema.js";
import {
  MEMORY_MAX_REVISIONS,
  MEMORY_REVIEW_RETENTION_MS,
  MEMORY_REVISION_RETENTION_MS,
  MEMORY_STATUS_RETENTION_MS,
  MEMORY_SUPPRESSION_RETENTION_MS,
} from "./budget.js";

export interface MemoryRetentionResult {
  expired: number;
  revisions: number;
  reviews: number;
  statuses: number;
  suppressions: number;
}

/**
 * Bounded cleanup for memory rows that are not active. Active entries are only
 * removed by budget eviction, never by age.
 */
export function purgeMemoryRetention(db: DbExecutor, now: number): MemoryRetentionResult {
  const expired = db
    .update(memories)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(memories.status, "active"), lt(memories.expiresAt, now)))
    .run().changes;

  const revisions = trimRevisions(db, now);
  const reviews = db
    .delete(memories)
    .where(
      and(eq(memories.status, "review"), lt(memories.updatedAt, now - MEMORY_REVIEW_RETENTION_MS)),
    )
    .run().changes;
  const statuses = db
    .delete(memories)
    .where(
      and(
        inArray(memories.status, ["rejected", "expired", "evicted"]),
        lt(memories.updatedAt, now - MEMORY_STATUS_RETENTION_MS),
      ),
    )
    .run().changes;
  const suppressions = db
    .delete(memorySuppressions)
    .where(
      and(
        lt(memorySuppressions.expiresAt, now),
        lt(memorySuppressions.createdAt, now - MEMORY_SUPPRESSION_RETENTION_MS),
      ),
    )
    .run().changes;

  return { expired, revisions, reviews, statuses, suppressions };
}

/** Keeps at most three revisions per memory and drops revisions older than 30 days. */
export function trimRevisions(db: DbExecutor, now: number): number {
  const rows = db
    .select()
    .from(memoryRevisions)
    .orderBy(memoryRevisions.memoryId, memoryRevisions.revision)
    .all();
  const byMemory = new Map<string, typeof rows>();

  for (const row of rows) {
    const list = byMemory.get(row.memoryId) ?? [];
    list.push(row);
    byMemory.set(row.memoryId, list);
  }

  const remove: string[] = [];

  for (const list of byMemory.values()) {
    list.sort((left, right) => right.revision - left.revision);

    for (const [index, row] of list.entries()) {
      if (index >= MEMORY_MAX_REVISIONS || row.changedAt < now - MEMORY_REVISION_RETENTION_MS) {
        remove.push(row.id);
      }
    }
  }

  if (remove.length === 0) return 0;

  return db.delete(memoryRevisions).where(inArray(memoryRevisions.id, remove)).run().changes;
}
