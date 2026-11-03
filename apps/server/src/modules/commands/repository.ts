import { and, eq, inArray, lt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  browserSessions,
  type CommandExecutionRow,
  commandExecutions,
  resourceOperations,
} from "../../db/schema.js";
export function commandRow(db: DbExecutor, id: string) {
  return db.select().from(commandExecutions).where(eq(commandExecutions.id, id)).get() ?? null;
}
export function commandByOperation(db: DbExecutor, id: string) {
  return (
    db.select().from(commandExecutions).where(eq(commandExecutions.operationId, id)).get() ?? null
  );
}
export function insertCommand(db: DbExecutor, row: CommandExecutionRow) {
  db.insert(commandExecutions).values(row).run();
}
export function updateCommand(db: DbExecutor, id: string, fields: Partial<CommandExecutionRow>) {
  db.update(commandExecutions).set(fields).where(eq(commandExecutions.id, id)).run();
}
export function unfinishedCommands(db: DbExecutor) {
  return db
    .select()
    .from(commandExecutions)
    .where(inArray(commandExecutions.status, ["CREATED", "RUNNING", "CANCELLING"]))
    .all();
}
export function oldCommands(db: DbExecutor, cutoff: number) {
  return db.select().from(commandExecutions).where(lt(commandExecutions.endedAt, cutoff)).all();
}
export function operationRow(db: DbExecutor, id: string) {
  return db.select().from(resourceOperations).where(eq(resourceOperations.id, id)).get() ?? null;
}
export function activeCommandClient(db: DbExecutor, id: string, now: number, idleTtlMinutes = 30) {
  const row = db.select().from(browserSessions).where(eq(browserSessions.id, id)).get();
  return (
    row !== undefined &&
    row.revokedAt === null &&
    row.expiresAt > now &&
    row.lastSeenAt + idleTtlMinutes * 60_000 > now
  );
}
export function deleteCommand(db: DbExecutor, row: CommandExecutionRow) {
  const operation = operationRow(db, row.operationId);
  if (!operation || !["COMPLETED", "FAILED"].includes(operation.status)) return;
  db.delete(commandExecutions).where(eq(commandExecutions.id, row.id)).run();
  db.delete(resourceOperations)
    .where(
      and(eq(resourceOperations.id, row.operationId), eq(resourceOperations.kind, "command.run")),
    )
    .run();
}
