import { asc, eq, inArray, lt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type TerminalLeaseRow,
  type TerminalRow,
  terminalLeases,
  terminals,
} from "../../db/schema.js";
export const terminalRow = (db: DbExecutor, id: string) =>
  db.select().from(terminals).where(eq(terminals.id, id)).get() ?? null;
export const leaseRow = (db: DbExecutor, id: string) =>
  db.select().from(terminalLeases).where(eq(terminalLeases.terminalId, id)).get() ?? null;
export function insertTerminal(db: DbExecutor, row: TerminalRow) {
  db.insert(terminals).values(row).run();
  db.insert(terminalLeases).values({ terminalId: row.id }).run();
}
export function updateTerminal(db: DbExecutor, id: string, fields: Partial<TerminalRow>) {
  db.update(terminals).set(fields).where(eq(terminals.id, id)).run();
}
export function updateLease(db: DbExecutor, id: string, fields: Partial<TerminalLeaseRow>) {
  db.update(terminalLeases).set(fields).where(eq(terminalLeases.terminalId, id)).run();
}
export function allTerminals(db: DbExecutor) {
  return db.select().from(terminals).orderBy(asc(terminals.createdAt), asc(terminals.id)).all();
}
export function activeTerminals(db: DbExecutor) {
  return db
    .select()
    .from(terminals)
    .where(inArray(terminals.status, ["CREATED", "RUNNING", "STOPPING"]))
    .all();
}
export function oldTerminals(db: DbExecutor, cutoff: number) {
  return db.select().from(terminals).where(lt(terminals.endedAt, cutoff)).all();
}
export function deleteTerminal(db: DbExecutor, id: string) {
  db.delete(terminalLeases).where(eq(terminalLeases.terminalId, id)).run();
  db.delete(terminals).where(eq(terminals.id, id)).run();
}

import { isInsideRoot } from "@larness/resources";
import { operationRow } from "../commands/repository.js";
export function rootHasTerminal(db: DbExecutor, root: string) {
  return activeTerminals(db).some((row) => {
    const op = operationRow(db, row.operationId);
    return op && (isInsideRoot(root, op.rootRealPath) || isInsideRoot(op.rootRealPath, root));
  });
}
