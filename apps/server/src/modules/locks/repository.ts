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
import { rootIsQuarantined } from "./quarantine.js";

export function rootHasWriter(
  db: DbExecutor,
  root: string,
  now: number,
  excludeLockId?: string,
): boolean {
  if (rootIsQuarantined(root)) return true;
  const overlaps = (other: string) => isInsideRoot(root, other) || isInsideRoot(other, root);
  if (
    pendingOperations(db).some(
      (operation) =>
        overlaps(operation.rootRealPath) &&
        // The writer's own in-flight operation is not a competing writer.
        // An operation awaiting reconciliation stays a barrier.
        !(operation.lockId === excludeLockId && operation.status !== "RECONCILIATION_REQUIRED"),
    )
  )
    return true;
  return db
    .select()
    .from(resourceLocks)
    .all()
    .some((lock) => {
      if (lock.id === excludeLockId) return false;
      if (lock.rootRealPath === null || !overlaps(lock.rootRealPath)) return false;
      // expiresAt = 0 is an explicit release tombstone, not an active writer.
      if (lock.expiresAt <= 0) return false;
      if (lock.expiresAt > now) return true;
      const turn = db.select().from(turns).where(eq(turns.id, lock.executionId)).get();
      return (
        turn !== undefined &&
        ["QUEUED", "PREPARING", "RUNNING", "WAITING_APPROVAL", "CANCELLING"].includes(turn.status)
      );
    });
}

export function getResourceLockRowById(db: DbExecutor, id: string): ResourceLockRow | null {
  return db.select().from(resourceLocks).where(eq(resourceLocks.id, id)).get() ?? null;
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
  },
): ResourceLockRow | null {
  const changes = db
    .update(resourceLocks)
    .set({ expiresAt: input.expiresAt, heartbeatAt: input.heartbeatAt })
    .where(
      and(
        eq(resourceLocks.id, input.id),
        eq(resourceLocks.fencingToken, input.fencingToken),
        // expiresAt = 0 is the release tombstone. An expired lease may still be
        // revived by the fencing owner; a takeover increments the token.
        gt(resourceLocks.expiresAt, 0),
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
