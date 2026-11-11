import type { Database } from "../../../db/client.js";
import { appendAudit } from "../../../db/repositories/audit.js";
import type { TurnStatus } from "../../../db/schema.js";
import { immediateTransaction } from "../../../db/transaction.js";
import { getSessionById, getTurnById, updateTurnRow } from "../../sessions/repository.js";
import { createTurn } from "../../sessions/turns.js";
import { appendAgentEvent } from "../events.js";
import { checkpointMessage, factsAreEmpty, loadTurnFacts } from "../turnCheckpoint.js";

export type ResumeErrorCode =
  | "TURN_NOT_FOUND"
  | "TURN_NOT_RESUMABLE"
  | "SESSION_NOT_FOUND"
  | "MODEL_UNAVAILABLE";

export class ResumeError extends Error {
  readonly code: ResumeErrorCode;

  constructor(code: ResumeErrorCode, message: string) {
    super(message);
    this.name = "ResumeError";
    this.code = code;
  }
}

export interface ResumeTurnResult {
  turnId: string;
  status: TurnStatus;
  sessionId: string;
  resumedFromTurnId: string;
}

function turnGoal(inputJson: string): string {
  try {
    const parsed = JSON.parse(inputJson) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

/**
 * Continue an interrupted Turn in a NEW Turn (ADR-058 decision 1). The old Turn
 * stays untouched; the new one carries verified facts and reuses the original
 * provider/model snapshot. Repeating the call returns the same Turn.
 */
export function resumeInterruptedTurn(
  options: { db: Database; now?: () => number },
  input: { turnId: string; clientSessionId?: string },
): ResumeTurnResult {
  const now = options.now?.() ?? Date.now();
  const turn = getTurnById(options.db, input.turnId);

  if (turn === null) {
    throw new ResumeError("TURN_NOT_FOUND", "turn not found");
  }

  if (turn.status !== "INTERRUPTED") {
    throw new ResumeError(
      "TURN_NOT_RESUMABLE",
      `only an interrupted turn can be resumed (current: ${turn.status})`,
    );
  }

  const session = getSessionById(options.db, turn.sessionId);

  if (session === null) {
    throw new ResumeError("SESSION_NOT_FOUND", "session not found");
  }

  const facts = loadTurnFacts(options.db, turn.id, turnGoal(turn.inputJson));

  if (factsAreEmpty(facts)) {
    throw new ResumeError(
      "TURN_NOT_RESUMABLE",
      "this turn has no recoverable progress to carry over",
    );
  }

  const text = checkpointMessage(facts, now).content;
  let created: { turnId: string; status: TurnStatus; sessionId: string };

  try {
    created = createTurn(
      { db: options.db, now: () => now },
      {
        sessionId: turn.sessionId,
        text,
        model: turn.model,
        thinking: turn.thinking,
        credentialProfileId: turn.credentialProfileId,
        idempotencyKey: `resume:${turn.id}`,
        ...(input.clientSessionId === undefined ? {} : { clientSessionId: input.clientSessionId }),
      },
    );
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String((error as { code: unknown }).code)
        : "MODEL_UNAVAILABLE";

    throw new ResumeError(
      code === "MODEL_UNSUPPORTED" || code === "MODEL_UNAVAILABLE"
        ? "MODEL_UNAVAILABLE"
        : code === "NOT_FOUND"
          ? "SESSION_NOT_FOUND"
          : "TURN_NOT_RESUMABLE",
      error instanceof Error ? error.message : "cannot resume this turn",
    );
  }

  const resumed = getTurnById(options.db, created.turnId);

  if (resumed === null || resumed.resumedFromTurnId !== null) {
    return {
      turnId: created.turnId,
      status: created.status,
      sessionId: created.sessionId,
      resumedFromTurnId: turn.id,
    };
  }

  immediateTransaction(options.db, (tx) => {
    updateTurnRow(tx, created.turnId, { resumedFromTurnId: turn.id });
    appendAgentEvent(tx, {
      sessionId: created.sessionId,
      turnId: created.turnId,
      type: "turn.resumed",
      payload: { turnId: created.turnId, fromTurnId: turn.id },
      now,
    });
    appendAudit(tx, {
      action: "turn.resumed",
      decision: "allow",
      ...(input.clientSessionId === undefined ? {} : { clientSessionId: input.clientSessionId }),
      sessionId: created.sessionId,
      resourceType: "turn",
      resourceId: created.turnId,
      details: { fromTurnId: turn.id, status: created.status },
      now,
    });
  });

  return {
    turnId: created.turnId,
    status: created.status,
    sessionId: created.sessionId,
    resumedFromTurnId: turn.id,
  };
}
