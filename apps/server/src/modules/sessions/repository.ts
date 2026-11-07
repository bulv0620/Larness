import { and, desc, eq, exists, inArray, ne } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  type SessionRow,
  sessions,
  type TurnRow,
  type TurnStatus,
  turns,
} from "../../db/schema.js";

export const ACTIVE_TURN_STATUSES: TurnStatus[] = [
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "CANCELLING",
];

export function isActiveTurnStatus(status: TurnStatus): boolean {
  return ACTIVE_TURN_STATUSES.includes(status);
}

export interface CreateSessionRowInput {
  id: string;
  projectId: string | null;
  workspacePath: string;
  title: string;
  modelProfileId: string | null;
  model?: string | null;
  thinking?: string | null;
  approvalPolicyId: string;
  now: number;
}

export function createSessionRow(db: DbExecutor, input: CreateSessionRowInput): SessionRow {
  const row: SessionRow = {
    id: input.id,
    projectId: input.projectId,
    workspacePath: input.workspacePath,
    title: input.title,
    status: "active",
    modelProfileId: input.modelProfileId,
    model: input.model ?? null,
    thinking: input.thinking ?? null,
    approvalPolicyId: input.approvalPolicyId,
    createdAt: input.now,
    updatedAt: input.now,
    lastActivityAt: input.now,
  };

  db.insert(sessions).values(row).run();
  return row;
}

export function getSessionById(db: DbExecutor, id: string): SessionRow | null {
  return db.select().from(sessions).where(eq(sessions.id, id)).get() ?? null;
}

export function listSessionRows(
  db: DbExecutor,
  options: { projectId?: string; limit: number },
): { session: SessionRow; hasActiveTurn: boolean }[] {
  const active = ne(sessions.status, "archived");
  const where =
    options.projectId === undefined
      ? active
      : and(active, eq(sessions.projectId, options.projectId));

  const activeTurn = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, sessions.id), inArray(turns.status, ACTIVE_TURN_STATUSES)));

  return db
    .select({ session: sessions, hasActiveTurn: exists(activeTurn).mapWith(Boolean) })
    .from(sessions)
    .where(where)
    .orderBy(desc(sessions.updatedAt), desc(sessions.id))
    .limit(options.limit)
    .all();
}

export function updateSessionRow(
  db: DbExecutor,
  id: string,
  input: {
    title?: string;
    modelProfileId?: string | null;
    model?: string | null;
    thinking?: string | null;
    approvalPolicyId?: string;
    status?: SessionRow["status"];
    updatedAt: number;
    lastActivityAt?: number;
  },
): SessionRow | null {
  const changes = {
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.modelProfileId === undefined ? {} : { modelProfileId: input.modelProfileId }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
    ...(input.approvalPolicyId === undefined ? {} : { approvalPolicyId: input.approvalPolicyId }),
    ...(input.status === undefined ? {} : { status: input.status }),
    updatedAt: input.updatedAt,
    ...(input.lastActivityAt === undefined ? {} : { lastActivityAt: input.lastActivityAt }),
  };

  db.update(sessions).set(changes).where(eq(sessions.id, id)).run();
  return getSessionById(db, id);
}

export function touchSessionRow(db: DbExecutor, id: string, now: number): void {
  db.update(sessions).set({ updatedAt: now, lastActivityAt: now }).where(eq(sessions.id, id)).run();
}

export interface CreateTurnRowInput {
  id: string;
  sessionId: string;
  modelProfileId: string | null;
  provider: string | null;
  model: string | null;
  thinking?: string | null;
  contextWindow?: number | null;
  status: TurnStatus;
  inputJson: string;
  idempotencyKey: string | null;
  now: number;
}

export function createTurnRow(db: DbExecutor, input: CreateTurnRowInput): TurnRow {
  const row: TurnRow = {
    id: input.id,
    sessionId: input.sessionId,
    modelProfileId: input.modelProfileId,
    provider: input.provider,
    model: input.model,
    thinking: input.thinking ?? null,
    contextWindow: input.contextWindow ?? null,
    status: input.status,
    inputJson: input.inputJson,
    usageJson: null,
    errorJson: null,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.now,
    startedAt: null,
    endedAt: null,
  };

  db.insert(turns).values(row).run();
  return row;
}

export function newTurnId(): string {
  return newId("trn");
}

export function getTurnById(db: DbExecutor, id: string): TurnRow | null {
  return db.select().from(turns).where(eq(turns.id, id)).get() ?? null;
}

export function findTurnBySessionAndIdempotencyKey(
  db: DbExecutor,
  sessionId: string,
  idempotencyKey: string,
): TurnRow | null {
  return (
    db
      .select()
      .from(turns)
      .where(and(eq(turns.sessionId, sessionId), eq(turns.idempotencyKey, idempotencyKey)))
      .get() ?? null
  );
}

export function findActiveTurnForSession(db: DbExecutor, sessionId: string): TurnRow | null {
  return (
    db
      .select()
      .from(turns)
      .where(and(eq(turns.sessionId, sessionId), inArray(turns.status, ACTIVE_TURN_STATUSES)))
      .orderBy(desc(turns.createdAt))
      .limit(1)
      .get() ?? null
  );
}

export function listActiveTurnRows(db: DbExecutor): TurnRow[] {
  return db
    .select()
    .from(turns)
    .where(inArray(turns.status, ACTIVE_TURN_STATUSES))
    .orderBy(turns.createdAt)
    .all();
}

export function updateTurnRow(
  db: DbExecutor,
  id: string,
  input: {
    status?: TurnStatus;
    provider?: string | null;
    model?: string | null;
    startedAt?: number | null;
    endedAt?: number | null;
    usageJson?: string | null;
    errorJson?: string | null;
  },
): TurnRow | null {
  const changes = {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.provider === undefined ? {} : { provider: input.provider }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
    ...(input.usageJson === undefined ? {} : { usageJson: input.usageJson }),
    ...(input.errorJson === undefined ? {} : { errorJson: input.errorJson }),
  };

  db.update(turns).set(changes).where(eq(turns.id, id)).run();
  return getTurnById(db, id);
}
