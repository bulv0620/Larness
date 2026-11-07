import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type ScheduledJobRow,
  type ScheduledJobRunRow,
  scheduledJobRuns,
  scheduledJobs,
} from "../../db/schema.js";

export function jobById(db: DbExecutor, id: string): ScheduledJobRow | null {
  return db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get() ?? null;
}

export function listJobRows(db: DbExecutor, options?: { includeArchived?: boolean }) {
  const where = options?.includeArchived ? undefined : isNull(scheduledJobs.archivedAt);
  return db
    .select()
    .from(scheduledJobs)
    .where(where)
    .orderBy(desc(scheduledJobs.updatedAt), asc(scheduledJobs.id))
    .all();
}

export function insertJobRow(db: DbExecutor, row: ScheduledJobRow): void {
  db.insert(scheduledJobs).values(row).run();
}

export function updateJobRow(db: DbExecutor, id: string, patch: Partial<ScheduledJobRow>): void {
  db.update(scheduledJobs).set(patch).where(eq(scheduledJobs.id, id)).run();
}

export function dueJobRows(db: DbExecutor, now: number, limit = 20): ScheduledJobRow[] {
  return db
    .select()
    .from(scheduledJobs)
    .where(
      and(
        eq(scheduledJobs.enabled, true),
        isNull(scheduledJobs.archivedAt),
        sql`${scheduledJobs.nextRunAt} IS NOT NULL`,
        sql`${scheduledJobs.nextRunAt} <= ${now}`,
      ),
    )
    .orderBy(asc(scheduledJobs.nextRunAt), asc(scheduledJobs.id))
    .limit(limit)
    .all();
}

export function enabledJobRows(db: DbExecutor): ScheduledJobRow[] {
  return db
    .select()
    .from(scheduledJobs)
    .where(and(eq(scheduledJobs.enabled, true), isNull(scheduledJobs.archivedAt)))
    .all();
}

export function runById(db: DbExecutor, id: string): ScheduledJobRunRow | null {
  return db.select().from(scheduledJobRuns).where(eq(scheduledJobRuns.id, id)).get() ?? null;
}

export function insertRunRow(db: DbExecutor, row: ScheduledJobRunRow): void {
  db.insert(scheduledJobRuns).values(row).run();
}

export function updateRunRow(db: DbExecutor, id: string, patch: Partial<ScheduledJobRunRow>): void {
  db.update(scheduledJobRuns).set(patch).where(eq(scheduledJobRuns.id, id)).run();
}

export function listRunRows(
  db: DbExecutor,
  jobId: string,
  options: { limit: number; cursor?: string },
): ScheduledJobRunRow[] {
  const where = [eq(scheduledJobRuns.jobId, jobId)];

  if (options.cursor !== undefined) {
    const cursor = runById(db, options.cursor);
    if (cursor === null || cursor.jobId !== jobId) {
      return [];
    }

    const cursorWhere = or(
      lt(scheduledJobRuns.createdAt, cursor.createdAt),
      and(eq(scheduledJobRuns.createdAt, cursor.createdAt), lt(scheduledJobRuns.id, cursor.id)),
    );
    if (cursorWhere === undefined) {
      return [];
    }
    where.push(cursorWhere);
  }

  return db
    .select()
    .from(scheduledJobRuns)
    .where(and(...where))
    .orderBy(desc(scheduledJobRuns.createdAt), desc(scheduledJobRuns.id))
    .limit(options.limit + 1)
    .all();
}

export function activeRunForJob(db: DbExecutor, jobId: string): ScheduledJobRunRow | null {
  return (
    db
      .select()
      .from(scheduledJobRuns)
      .where(
        and(
          eq(scheduledJobRuns.jobId, jobId),
          inArray(scheduledJobRuns.status, ["queued", "running"]),
        ),
      )
      .orderBy(desc(scheduledJobRuns.createdAt))
      .get() ?? null
  );
}

export function latestRunForJob(db: DbExecutor, jobId: string): ScheduledJobRunRow | null {
  return (
    db
      .select()
      .from(scheduledJobRuns)
      .where(eq(scheduledJobRuns.jobId, jobId))
      .orderBy(desc(scheduledJobRuns.createdAt), desc(scheduledJobRuns.id))
      .get() ?? null
  );
}

export function queuedRunRows(db: DbExecutor): ScheduledJobRunRow[] {
  return db
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.status, "queued"))
    .orderBy(asc(scheduledJobRuns.createdAt), asc(scheduledJobRuns.id))
    .all();
}

export function runningRunRows(db: DbExecutor): ScheduledJobRunRow[] {
  return db
    .select()
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.status, "running"))
    .orderBy(asc(scheduledJobRuns.createdAt), asc(scheduledJobRuns.id))
    .all();
}

export function runningRunCount(db: DbExecutor): number {
  const row = db
    .select({ value: count() })
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.status, "running"))
    .get();
  return row?.value ?? 0;
}

export function failedRunCountSince(db: DbExecutor, since: number): number {
  const row = db
    .select({ value: count() })
    .from(scheduledJobRuns)
    .where(
      and(
        inArray(scheduledJobRuns.status, ["failed", "timed_out", "interrupted"]),
        sql`${scheduledJobRuns.createdAt} >= ${since}`,
      ),
    )
    .get();
  return row?.value ?? 0;
}

export function trimRunsForJob(
  db: DbExecutor,
  jobId: string,
  options: { keep: number; olderThan: number },
): void {
  const rows = db
    .select({ id: scheduledJobRuns.id, createdAt: scheduledJobRuns.createdAt })
    .from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.jobId, jobId))
    .orderBy(desc(scheduledJobRuns.createdAt), desc(scheduledJobRuns.id))
    .all();

  const remove = new Set<string>();
  rows.forEach((row, index) => {
    if (index >= options.keep || row.createdAt < options.olderThan) {
      remove.add(row.id);
    }
  });

  if (remove.size > 0) {
    db.delete(scheduledJobRuns)
      .where(inArray(scheduledJobRuns.id, [...remove]))
      .run();
  }
}

export function jobCount(db: DbExecutor): number {
  const row = db
    .select({ value: count() })
    .from(scheduledJobs)
    .where(isNull(scheduledJobs.archivedAt))
    .get();
  return row?.value ?? 0;
}
