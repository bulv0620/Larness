import type { Database } from "../../../db/client.js";
import { appendAudit } from "../../../db/repositories/audit.js";
import { immediateTransaction } from "../../../db/transaction.js";
import { getSessionById, getTurnById, updateTurnRow } from "../../sessions/repository.js";
import { createTurn } from "../../sessions/turns.js";
import { appendAgentEvent } from "../events.js";
import { checkpointMessage, factsAreEmpty, loadTurnFacts } from "../turnCheckpoint.js";

export const DEFAULT_MAX_CONTINUATIONS = 3;

export interface ContinuationResult {
  turnId: string;
  sessionId: string;
  fromTurnId: string;
  depth: number;
}

function turnGoal(inputJson: string): string {
  try {
    const parsed = JSON.parse(inputJson) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    return "";
  }
}

/** How many turns already continue this one (the original turn is depth 0). */
function chainDepth(db: Database, turnId: string): number {
  let depth = 0;
  let current = getTurnById(db, turnId);

  while (current?.resumedFromTurnId != null && depth < 32) {
    depth += 1;
    current = getTurnById(db, current.resumedFromTurnId);
  }

  return depth;
}

/**
 * Continue a turn that stopped on a budget instead of failing the task
 * (ADR-059). The new turn carries verified facts; the chain is capped.
 */
export function continueBudgetedTurn(
  options: { db: Database; maxContinuations?: number; now?: () => number },
  input: { turnId: string },
): ContinuationResult | null {
  const maxContinuations = options.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const now = options.now?.() ?? Date.now();
  const turn = getTurnById(options.db, input.turnId);

  if (turn === null || turn.status !== "COMPLETED" || turn.terminalReason !== "budget") {
    return null;
  }

  const session = getSessionById(options.db, turn.sessionId);

  // Scheduled jobs own their own timeout and must not chain turns.
  if (session === null || session.origin !== "user") {
    return null;
  }

  const depth = chainDepth(options.db, turn.id);

  if (depth >= maxContinuations) {
    return null;
  }

  const facts = loadTurnFacts(options.db, turn.id, turnGoal(turn.inputJson));

  if (factsAreEmpty(facts)) {
    return null;
  }

  let created: { turnId: string; status: string; sessionId: string };

  try {
    created = createTurn(
      { db: options.db, now: () => now },
      {
        sessionId: turn.sessionId,
        text: checkpointMessage(facts, now).content,
        model: turn.model,
        thinking: turn.thinking,
        credentialProfileId: turn.credentialProfileId,
        idempotencyKey: `continue:${turn.id}`,
      },
    );
  } catch {
    return null;
  }

  immediateTransaction(options.db, (tx) => {
    updateTurnRow(tx, created.turnId, { resumedFromTurnId: turn.id });
    appendAgentEvent(tx, {
      sessionId: created.sessionId,
      turnId: created.turnId,
      type: "turn.continued",
      payload: { turnId: created.turnId, fromTurnId: turn.id, depth: depth + 1 },
      now,
    });
    appendAudit(tx, {
      action: "turn.continued",
      decision: "allow",
      sessionId: created.sessionId,
      resourceType: "turn",
      resourceId: created.turnId,
      details: { fromTurnId: turn.id, depth: depth + 1 },
      now,
    });
  });

  return {
    turnId: created.turnId,
    sessionId: created.sessionId,
    fromTurnId: turn.id,
    depth: depth + 1,
  };
}
