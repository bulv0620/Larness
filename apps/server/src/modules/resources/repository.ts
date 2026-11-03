import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  fileVersions,
  type ResourceOperationRow,
  resourceEvents,
  resourceOperations,
  resourceStreams,
} from "../../db/schema.js";

export function findOperation(db: DbExecutor, client: string, key: string) {
  return (
    db
      .select()
      .from(resourceOperations)
      .where(
        and(
          eq(resourceOperations.clientSessionId, client),
          eq(resourceOperations.kind, "file.save"),
          eq(resourceOperations.idempotencyKey, key),
        ),
      )
      .get() ?? null
  );
}
export function pendingOperations(db: DbExecutor) {
  return db
    .select()
    .from(resourceOperations)
    .where(inArray(resourceOperations.status, ["PREPARED", "WRITING", "RECONCILIATION_REQUIRED"]))
    .all();
}
export function insertOperation(db: DbExecutor, row: ResourceOperationRow) {
  db.insert(resourceOperations).values(row).run();
}
export function updateOperation(
  db: DbExecutor,
  id: string,
  values: Partial<Pick<ResourceOperationRow, "status" | "resultJson" | "errorCode" | "updatedAt">>,
) {
  db.update(resourceOperations).set(values).where(eq(resourceOperations.id, id)).run();
}
export function cacheFileVersion(db: DbExecutor, input: typeof fileVersions.$inferInsert) {
  db.insert(fileVersions)
    .values(input)
    .onConflictDoUpdate({
      target: [fileVersions.scopeKey, fileVersions.path],
      set: input,
    })
    .run();
}
// Caller wraps this and the business result in the same immediate transaction.
export function appendResourceEvent(
  db: DbExecutor,
  streamId: string,
  type: string,
  payload: unknown,
  now: number,
) {
  const stream = db
    .insert(resourceStreams)
    .values({ streamId, lastSeq: 1 })
    .onConflictDoUpdate({
      target: resourceStreams.streamId,
      set: { lastSeq: sql`${resourceStreams.lastSeq} + 1` },
    })
    .returning()
    .get();
  const row = {
    id: newId("evt"),
    streamId,
    seq: stream.lastSeq,
    type,
    payloadJson: JSON.stringify(payload),
    createdAt: now,
  };
  db.insert(resourceEvents).values(row).run();
  return row;
}
