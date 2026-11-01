import type { ServerEvent } from "@larness/shared";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { type AgentEventRow, agentEvents, type SessionRow } from "../../db/schema.js";
import { SessionError } from "../sessions/errors.js";
import { getSessionById } from "../sessions/repository.js";

export type AgentEventType =
  | "user.message"
  | "turn.created"
  | "turn.status"
  | "turn.completed"
  | "turn.failed"
  | "turn.cancelled"
  | "turn.interrupted"
  | "assistant.message"
  | "tool.requested"
  | "tool.approval.required"
  | "tool.approval.resolved"
  | "tool.started"
  | "tool.completed"
  | "tool.failed"
  | "file.changed"
  | "plan.updated";

export interface AppendAgentEventInput {
  sessionId: string;
  turnId?: string | null;
  type: AgentEventType | string;
  payload?: unknown;
  now: number;
}

export function appendAgentEvent(db: DbExecutor, input: AppendAgentEventInput): AgentEventRow {
  const last = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, input.sessionId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();

  const row: AgentEventRow = {
    id: newId("evt"),
    sessionId: input.sessionId,
    turnId: input.turnId ?? null,
    seq: (last?.seq ?? 0) + 1,
    type: input.type,
    payloadJson: JSON.stringify(input.payload ?? {}),
    createdAt: input.now,
  };

  db.insert(agentEvents).values(row).run();
  return row;
}

function parsePayload(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function toServerEvent(row: AgentEventRow, session: SessionRow): ServerEvent {
  return {
    kind: "event",
    eventId: row.id,
    protocolVersion: 1,
    topic: "agent",
    streamId: row.sessionId,
    ...(session.projectId === null ? {} : { projectId: session.projectId }),
    sessionId: row.sessionId,
    sequence: row.seq,
    timestamp: row.createdAt,
    type: row.type,
    payload: parsePayload(row.payloadJson),
  };
}

export interface ListSessionEventsOptions {
  after?: number;
  limit?: number;
}

export interface SessionEventPage {
  items: ServerEvent[];
  nextSeq: number;
  hasMore: boolean;
}

export function listSessionEvents(
  db: DbExecutor,
  sessionId: string,
  options: ListSessionEventsOptions = {},
): SessionEventPage {
  const session = getSessionById(db, sessionId);

  if (session === null) {
    throw new SessionError("NOT_FOUND", "session not found");
  }

  const after = Math.max(0, Math.trunc(options.after ?? 0));
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const rows = db
    .select()
    .from(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), gt(agentEvents.seq, after)))
    .orderBy(asc(agentEvents.seq))
    .limit(limit + 1)
    .all();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => toServerEvent(row, session));

  return {
    items,
    nextSeq: items.at(-1)?.sequence ?? after,
    hasMore,
  };
}
