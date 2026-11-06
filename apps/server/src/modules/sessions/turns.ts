import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { TurnRow, TurnStatus } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { appendAgentEvent } from "../agent/events.js";
import { SessionError } from "./errors.js";
import {
  createTurnRow,
  findActiveTurnForSession,
  findTurnBySessionAndIdempotencyKey,
  getSessionById,
  getTurnById,
  isActiveTurnStatus,
  newTurnId,
  touchSessionRow,
  updateSessionRow,
  updateTurnRow,
} from "./repository.js";

const MAX_INPUT_LENGTH = 100_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
const DEFAULT_SESSION_TITLE = "New session";
const MAX_GENERATED_TITLE_LENGTH = 48;

export function deriveSessionTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_GENERATED_TITLE_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_GENERATED_TITLE_LENGTH - 1).trimEnd()}…`;
}

export interface TurnDto {
  id: string;
  sessionId: string;
  status: TurnStatus;
  modelProfileId: string | null;
  provider: string | null;
  model: string | null;
  input: { text: string };
  usage: unknown;
  error: unknown;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface TurnServiceOptions {
  db: Database;
  now?: () => number;
}

export interface CreateTurnInput {
  sessionId: string;
  text: string;
  modelProfileId?: string;
  idempotencyKey?: string;
  clientSessionId?: string;
  executionContext?: { domain: "service-ops"; targetId: string };
}

export interface CreateTurnResult {
  turnId: string;
  status: TurnStatus;
  sessionId: string;
}

export interface CancelTurnInput {
  turnId: string;
  clientSessionId?: string;
}

export interface CancelTurnResult {
  turnId: string;
  status: TurnStatus;
}

function parseJson(json: string | null): unknown {
  if (json === null) {
    return null;
  }

  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function turnDto(row: TurnRow): TurnDto {
  const input = parseJson(row.inputJson);
  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    modelProfileId: row.modelProfileId,
    provider: row.provider,
    model: row.model,
    input:
      typeof input === "object" &&
      input !== null &&
      typeof (input as { text?: unknown }).text === "string"
        ? { text: (input as { text: string }).text }
        : { text: "" },
    usage: parseJson(row.usageJson),
    error: parseJson(row.errorJson),
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

export function activeTurnForSession(db: Database, sessionId: string): TurnDto | null {
  const row = findActiveTurnForSession(db, sessionId);
  return row === null ? null : turnDto(row);
}

function validateCreateTurn(input: CreateTurnInput): {
  text: string;
  modelProfileId: string | null;
  idempotencyKey: string | null;
} {
  const text = input.text.trim();

  if (text.length === 0) {
    throw new SessionError("VALIDATION_ERROR", "turn input must not be empty");
  }

  if (text.length > MAX_INPUT_LENGTH) {
    throw new SessionError(
      "VALIDATION_ERROR",
      `turn input must be at most ${MAX_INPUT_LENGTH} characters`,
    );
  }

  const modelProfileId = input.modelProfileId?.trim() || null;

  if (modelProfileId !== null && modelProfileId.length > 128) {
    throw new SessionError("VALIDATION_ERROR", "modelProfileId must be at most 128 characters");
  }

  const idempotencyKey = input.idempotencyKey?.trim() || null;

  if (idempotencyKey !== null && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new SessionError(
      "VALIDATION_ERROR",
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    );
  }

  return { text, modelProfileId, idempotencyKey };
}

export function createTurn(options: TurnServiceOptions, input: CreateTurnInput): CreateTurnResult {
  const validated = validateCreateTurn(input);
  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    const session = getSessionById(tx, input.sessionId);

    if (session === null) {
      throw new SessionError("NOT_FOUND", "session not found");
    }

    if (validated.idempotencyKey !== null) {
      const existing = findTurnBySessionAndIdempotencyKey(
        tx,
        input.sessionId,
        validated.idempotencyKey,
      );

      if (existing !== null) {
        return {
          turnId: existing.id,
          status: existing.status,
          sessionId: existing.sessionId,
        };
      }
    }

    if (session.status === "archived") {
      throw new SessionError("CONFLICT", "session is archived");
    }

    const active = findActiveTurnForSession(tx, input.sessionId);

    if (active !== null) {
      throw new SessionError("TURN_IN_PROGRESS", "session already has an active turn", {
        turnId: active.id,
      });
    }

    if (session.title === DEFAULT_SESSION_TITLE) {
      updateSessionRow(tx, session.id, {
        title: deriveSessionTitle(validated.text),
        updatedAt: now,
        lastActivityAt: now,
      });
    }

    const row = createTurnRow(tx, {
      id: newTurnId(),
      sessionId: input.sessionId,
      modelProfileId: validated.modelProfileId,
      provider: null,
      model: null,
      status: "QUEUED",
      inputJson: JSON.stringify({
        text: validated.text,
        executionContext: {
          clientSessionId: input.clientSessionId,
          policySnapshotId: newId("pol"),
          policy: session.approvalPolicyId,
          ...(input.executionContext ?? {}),
        },
      }),
      idempotencyKey: validated.idempotencyKey,
      now,
    });

    appendAgentEvent(tx, {
      sessionId: row.sessionId,
      turnId: row.id,
      type: "user.message",
      payload: { turnId: row.id, text: validated.text },
      now,
    });
    appendAgentEvent(tx, {
      sessionId: row.sessionId,
      turnId: row.id,
      type: "turn.created",
      payload: { turnId: row.id, status: row.status },
      now,
    });

    touchSessionRow(tx, row.sessionId, now);
    appendAudit(tx, {
      action: "turn.started",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      sessionId: row.sessionId,
      resourceType: "turn",
      resourceId: row.id,
      details: { status: row.status },
      now,
    });

    return { turnId: row.id, status: row.status, sessionId: row.sessionId };
  });
}

export function cancelTurn(options: TurnServiceOptions, input: CancelTurnInput): CancelTurnResult {
  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    const row = getTurnById(tx, input.turnId);

    if (row === null) {
      throw new SessionError("NOT_FOUND", "turn not found");
    }

    if (!isActiveTurnStatus(row.status)) {
      throw new SessionError("CONFLICT", "turn is not active");
    }

    if (row.status === "CANCELLING") {
      return { turnId: row.id, status: row.status };
    }

    const updated = updateTurnRow(tx, row.id, { status: "CANCELLING" });

    if (updated === null) {
      throw new SessionError("INTERNAL", "failed to update turn");
    }

    appendAgentEvent(tx, {
      sessionId: updated.sessionId,
      turnId: updated.id,
      type: "turn.status",
      payload: { turnId: updated.id, status: "CANCELLING", reason: "user" },
      now,
    });
    appendAudit(tx, {
      action: "turn.cancelled",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      sessionId: updated.sessionId,
      resourceType: "turn",
      resourceId: updated.id,
      details: { status: "CANCELLING" },
      now,
    });
    touchSessionRow(tx, updated.sessionId, now);

    return { turnId: updated.id, status: updated.status };
  });
}
