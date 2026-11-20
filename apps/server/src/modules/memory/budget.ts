import type { MemoryRow, MemoryScope } from "../../db/schema.js";

export const DAY_MS = 24 * 60 * 60 * 1_000;

export const MEMORY_LIMITS = {
  project: { activeBytes: 64 * 1024, totalBytes: 192 * 1024, activeCount: 300 },
  global: { activeBytes: 8 * 1024, totalBytes: 24 * 1024, activeCount: 50 },
} as const;

export const MEMORY_MAX_BODY_CHARS = 4_000;
export const MEMORY_MAX_REVISIONS = 3;
export const MEMORY_REVISION_RETENTION_MS = 30 * DAY_MS;
export const MEMORY_REVIEW_MAX = 20;
export const MEMORY_REVIEW_RETENTION_MS = 14 * DAY_MS;
export const MEMORY_STATUS_RETENTION_MS = 30 * DAY_MS;
export const MEMORY_EVICTED_RESTORE_MS = 7 * DAY_MS;
export const MEMORY_SUPPRESSION_RETENTION_MS = 90 * DAY_MS;
export const MEMORY_SUPPRESSION_MAX = 500;
export const MEMORY_WRITES_PER_TURN_PROJECT = 3;
export const MEMORY_WRITES_PER_TURN_GLOBAL = 1;
export const MEMORY_AUTO_CONFIDENCE_PROJECT = 0.6;
export const MEMORY_AUTO_CONFIDENCE_GLOBAL = 0.9;

export function memoryBytes(key: string, title: string, body: string): number {
  return (
    Buffer.byteLength(key, "utf8") +
    Buffer.byteLength(title, "utf8") +
    Buffer.byteLength(body, "utf8")
  );
}

export function limitsFor(scope: MemoryScope): (typeof MEMORY_LIMITS)[MemoryScope] {
  return MEMORY_LIMITS[scope];
}

function staleAfterMs(row: MemoryRow): number | null {
  if (row.kind === "command" || row.kind === "fact") return 30 * DAY_MS;
  if (row.kind === "decision" || row.kind === "gotcha") return 180 * DAY_MS;
  return null;
}

export function isMemoryStale(row: MemoryRow, now: number): boolean {
  if (row.kind === "preference") return false;

  const threshold = staleAfterMs(row);

  if (threshold === null) return false;

  const verified = row.verifiedAt ?? row.lastConfirmedAt ?? row.updatedAt;
  return now - verified > threshold;
}

/** Higher is more valuable; eviction removes the lowest non-pinned entries first. */
export function memoryScore(row: MemoryRow, now: number): number {
  const lastUsed = row.lastUsedAt ?? row.updatedAt;
  const recency = 1 - Math.min(Math.max(now - lastUsed, 0) / (30 * DAY_MS), 1);
  const stale = isMemoryStale(row, now) ? 1 : 0;

  return (
    2 * row.confidence +
    0.15 * Math.min(row.useCount, 10) +
    recency -
    stale -
    0.5 * Math.min(row.correctionCount, 4)
  );
}

export function evictionOrder(rows: MemoryRow[], now: number): MemoryRow[] {
  return [...rows]
    .filter((row) => !row.pinned)
    .sort((left, right) => {
      const delta = memoryScore(left, now) - memoryScore(right, now);
      return delta === 0 ? left.key.localeCompare(right.key) : delta;
    });
}
