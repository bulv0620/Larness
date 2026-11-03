import { isInsideRoot } from "@larness/resources";
import { and, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type ResourceLockRow,
  type ResourceLockType,
  resourceLocks,
  turns,
} from "../../db/schema.js";
import { pendingOperations } from "../resources/repository.js";

export function rootHasWriter(db: DbExecutor, root: string, now: number): boolean {
  const overlaps = (other: string) => isInsideRoot(root, other) || isInsideRoot(other, root);
  if (pendingOperations(db).some((operation) => overlaps(operation.rootRealPath))) return true;
  return db
    .select()
    .from(resourceLocks)
    .all()
    .some((lock) => {
      if (lock.rootRealPath === null || !overlaps(lock.rootRealPath)) return false;
      if (lock.expiresAt > now) return true;
      const turn = db.select().from(turns).where(eq(turns.id, lock.executionId)).get();
      return (
        turn !== undefined &&
        ["QUEUED", "PREPARING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"].includes(turn.status)
      );
    });
}

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
    rootRealPath?: string | null;
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
