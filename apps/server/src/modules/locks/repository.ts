import { and, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { type ResourceLockRow, type ResourceLockType, resourceLocks } from "../../db/schema.js";

export function getResourceLockRow(
  db: DbExecutor,
  resourceType: ResourceLockType,
  resourceId: string,
): ResourceLockRow | null {
  return (
    db
      .select()
      .from(resourceLocks)
      .where(
        and(eq(resourceLocks.resourceType, resourceType), eq(resourceLocks.resourceId, resourceId)),
      )
      .get() ?? null
  );
}

export function insertResourceLockRow(db: DbExecutor, row: ResourceLockRow): ResourceLockRow {
  db.insert(resourceLocks).values(row).run();
  return row;
}

export function updateResourceLockRow(
  db: DbExecutor,
  id: string,
  input: {
    owner: string;
    executionId: string;
    fencingToken: number;
    expiresAt: number;
    heartbeatAt: number;
  },
): ResourceLockRow | null {
  db.update(resourceLocks).set(input).where(eq(resourceLocks.id, id)).run();

  return db.select().from(resourceLocks).where(eq(resourceLocks.id, id)).get() ?? null;
}

export function renewResourceLockRow(
  db: DbExecutor,
  input: {
    id: string;
    fencingToken: number;
    expiresAt: number;
    heartbeatAt: number;
    now: number;
  },
): ResourceLockRow | null {
  const changes = db
    .update(resourceLocks)
    .set({ expiresAt: input.expiresAt, heartbeatAt: input.heartbeatAt })
    .where(
      and(
        eq(resourceLocks.id, input.id),
        eq(resourceLocks.fencingToken, input.fencingToken),
        gt(resourceLocks.expiresAt, input.now),
      ),
    )
    .run().changes;

  if (changes === 0) {
    return null;
  }

  return db.select().from(resourceLocks).where(eq(resourceLocks.id, input.id)).get() ?? null;
}

export function releaseResourceLockRow(
  db: DbExecutor,
  input: { id: string; fencingToken: number; now: number },
): boolean {
  return (
    db
      .update(resourceLocks)
      .set({ expiresAt: 0, heartbeatAt: input.now })
      .where(
        and(eq(resourceLocks.id, input.id), eq(resourceLocks.fencingToken, input.fencingToken)),
      )
      .run().changes > 0
  );
}
