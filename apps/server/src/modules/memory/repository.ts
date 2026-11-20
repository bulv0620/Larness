import { and, asc, count, desc, eq, inArray, isNotNull, like, lt, or } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type MemoryRevisionRow,
  type MemoryRow,
  type MemoryScope,
  type MemoryStatus,
  type MemorySuppressionRow,
  memories,
  memoryRevisions,
  memorySuppressions,
} from "../../db/schema.js";

export interface MemoryListFilter {
  scope: MemoryScope;
  projectKey: string;
  status?: MemoryStatus;
  kind?: MemoryRow["kind"];
  q?: string;
  limit: number;
  offset: number;
}

export function memoryById(db: DbExecutor, id: string): MemoryRow | null {
  return db.select().from(memories).where(eq(memories.id, id)).get() ?? null;
}

export function activeMemoryByKey(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  key: string,
): MemoryRow | null {
  return (
    db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.scope, scope),
          eq(memories.projectKey, projectKey),
          eq(memories.key, key),
          eq(memories.status, "active"),
        ),
      )
      .get() ?? null
  );
}

export function memoryRowsByKey(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  key: string,
): MemoryRow[] {
  return db
    .select()
    .from(memories)
    .where(
      and(eq(memories.scope, scope), eq(memories.projectKey, projectKey), eq(memories.key, key)),
    )
    .orderBy(desc(memories.updatedAt))
    .all();
}

export function listMemoryRows(db: DbExecutor, filter: MemoryListFilter): MemoryRow[] {
  return db
    .select()
    .from(memories)
    .where(whereFor(filter))
    .orderBy(desc(memories.updatedAt), asc(memories.key))
    .limit(filter.limit)
    .offset(filter.offset)
    .all();
}

export function countMemoryRows(
  db: DbExecutor,
  filter: Omit<MemoryListFilter, "limit" | "offset">,
): number {
  return (
    db
      .select({ value: count() })
      .from(memories)
      .where(whereFor({ ...filter, limit: 0, offset: 0 }))
      .get()?.value ?? 0
  );
}

function whereFor(filter: MemoryListFilter) {
  const clauses = [eq(memories.scope, filter.scope), eq(memories.projectKey, filter.projectKey)];

  if (filter.status !== undefined) clauses.push(eq(memories.status, filter.status));
  if (filter.kind !== undefined) clauses.push(eq(memories.kind, filter.kind));
  if (filter.q !== undefined && filter.q.trim().length > 0) {
    const needle = `%${filter.q.trim().toLowerCase()}%`;
    const match = or(
      like(memories.key, needle),
      like(memories.title, needle),
      like(memories.body, needle),
    );
    if (match !== undefined) clauses.push(match);
  }

  return and(...clauses);
}

export function activeMemoryRows(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
): MemoryRow[] {
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.scope, scope),
        eq(memories.projectKey, projectKey),
        eq(memories.status, "active"),
      ),
    )
    .orderBy(desc(memories.pinned), desc(memories.confidence), asc(memories.key))
    .all();
}

export function memoryRowsByStatuses(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  statuses: MemoryStatus[],
): MemoryRow[] {
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.scope, scope),
        eq(memories.projectKey, projectKey),
        inArray(memories.status, statuses),
      ),
    )
    .orderBy(desc(memories.updatedAt))
    .all();
}

export function sumMemoryBytes(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  statuses?: MemoryStatus[],
): number {
  const rows = db
    .select({ bytes: memories.bytes })
    .from(memories)
    .where(
      statuses === undefined
        ? and(eq(memories.scope, scope), eq(memories.projectKey, projectKey))
        : and(
            eq(memories.scope, scope),
            eq(memories.projectKey, projectKey),
            inArray(memories.status, statuses),
          ),
    )
    .all();

  return rows.reduce((total, row) => total + row.bytes, 0);
}

export function countMemoryRowsByStatuses(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  statuses: MemoryStatus[],
): number {
  return (
    db
      .select({ value: count() })
      .from(memories)
      .where(
        and(
          eq(memories.scope, scope),
          eq(memories.projectKey, projectKey),
          inArray(memories.status, statuses),
        ),
      )
      .get()?.value ?? 0
  );
}

export function insertMemoryRow(db: DbExecutor, row: MemoryRow): void {
  db.insert(memories).values(row).run();
}

export function updateMemoryRow(db: DbExecutor, id: string, patch: Partial<MemoryRow>): void {
  db.update(memories).set(patch).where(eq(memories.id, id)).run();
}

export function deleteMemoryRow(db: DbExecutor, id: string): boolean {
  return db.delete(memories).where(eq(memories.id, id)).run().changes > 0;
}

export function incrementMemoryUsage(db: DbExecutor, id: string, now: number): void {
  const row = memoryById(db, id);
  if (row === null) return;
  db.update(memories)
    .set({ useCount: row.useCount + 1, lastUsedAt: now })
    .where(eq(memories.id, id))
    .run();
}

export function expireDueMemoryRows(db: DbExecutor, now: number): number {
  return db
    .update(memories)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(memories.status, "active"),
        isNotNull(memories.expiresAt),
        lt(memories.expiresAt, now),
      ),
    )
    .run().changes;
}

export function insertRevisionRow(db: DbExecutor, row: MemoryRevisionRow): void {
  db.insert(memoryRevisions).values(row).run();
}

export function listRevisionRows(db: DbExecutor, memoryId: string): MemoryRevisionRow[] {
  return db
    .select()
    .from(memoryRevisions)
    .where(eq(memoryRevisions.memoryId, memoryId))
    .orderBy(desc(memoryRevisions.revision))
    .all();
}

export function countRevisionRows(db: DbExecutor, memoryId: string): number {
  return (
    db
      .select({ value: count() })
      .from(memoryRevisions)
      .where(eq(memoryRevisions.memoryId, memoryId))
      .get()?.value ?? 0
  );
}

export function allRevisionRows(db: DbExecutor): MemoryRevisionRow[] {
  return db
    .select()
    .from(memoryRevisions)
    .orderBy(asc(memoryRevisions.memoryId), desc(memoryRevisions.revision))
    .all();
}

export function sumRevisionBytes(db: DbExecutor, scope: MemoryScope, projectKey: string): number {
  const rows = db
    .select({ title: memoryRevisions.title, body: memoryRevisions.body })
    .from(memoryRevisions)
    .innerJoin(memories, eq(memoryRevisions.memoryId, memories.id))
    .where(and(eq(memories.scope, scope), eq(memories.projectKey, projectKey)))
    .all();

  return rows.reduce(
    (total, row) =>
      total + Buffer.byteLength(row.title, "utf8") + Buffer.byteLength(row.body, "utf8"),
    0,
  );
}

export function sumSuppressionBytes(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
): number {
  const rows = db
    .select({ key: memorySuppressions.key, bodyHash: memorySuppressions.bodyHash })
    .from(memorySuppressions)
    .where(and(eq(memorySuppressions.scope, scope), eq(memorySuppressions.projectKey, projectKey)))
    .all();

  return rows.reduce(
    (total, row) =>
      total + Buffer.byteLength(row.key, "utf8") + Buffer.byteLength(row.bodyHash, "utf8"),
    0,
  );
}

export function deleteRevisionRows(db: DbExecutor, ids: string[]): number {
  if (ids.length === 0) return 0;
  return db.delete(memoryRevisions).where(inArray(memoryRevisions.id, ids)).run().changes;
}

export function suppressionByKey(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  key: string,
): MemorySuppressionRow | null {
  return (
    db
      .select()
      .from(memorySuppressions)
      .where(
        and(
          eq(memorySuppressions.scope, scope),
          eq(memorySuppressions.projectKey, projectKey),
          eq(memorySuppressions.key, key),
        ),
      )
      .get() ?? null
  );
}

export function suppressionByBodyHash(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  bodyHash: string,
): MemorySuppressionRow | null {
  return (
    db
      .select()
      .from(memorySuppressions)
      .where(
        and(
          eq(memorySuppressions.scope, scope),
          eq(memorySuppressions.projectKey, projectKey),
          eq(memorySuppressions.bodyHash, bodyHash),
        ),
      )
      .get() ?? null
  );
}

export function upsertSuppressionRow(db: DbExecutor, row: MemorySuppressionRow): void {
  db.delete(memorySuppressions)
    .where(
      and(
        eq(memorySuppressions.scope, row.scope),
        eq(memorySuppressions.projectKey, row.projectKey),
        eq(memorySuppressions.key, row.key),
      ),
    )
    .run();
  db.insert(memorySuppressions).values(row).run();
}

export function deleteSuppressionRow(db: DbExecutor, id: string): boolean {
  return db.delete(memorySuppressions).where(eq(memorySuppressions.id, id)).run().changes > 0;
}

export function allSuppressionRows(db: DbExecutor): MemorySuppressionRow[] {
  return db.select().from(memorySuppressions).all();
}

export function deleteSuppressionRows(db: DbExecutor, ids: string[]): number {
  if (ids.length === 0) return 0;
  return db.delete(memorySuppressions).where(inArray(memorySuppressions.id, ids)).run().changes;
}

export function deleteMemoryRowsByStatusBefore(
  db: DbExecutor,
  statuses: MemoryStatus[],
  before: number,
): number {
  if (statuses.length === 0) return 0;
  return db
    .delete(memories)
    .where(and(inArray(memories.status, statuses), lt(memories.updatedAt, before)))
    .run().changes;
}
