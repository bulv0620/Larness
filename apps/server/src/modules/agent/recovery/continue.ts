import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { appendAudit } from "../../../db/repositories/audit.js";
import { agentEvents } from "../../../db/schema.js";
import { immediateTransaction } from "../../../db/transaction.js";
import { screenshotIds } from "../../sessions/attachments.js";
import { getSessionById, getTurnById, updateTurnRow } from "../../sessions/repository.js";
import { createTurn } from "../../sessions/turns.js";
import { appendAgentEvent } from "../events.js";
import { spentTokensFromJson } from "../turn/chain.js";
import { checkpointMessage, factsAreEmpty, loadTurnFacts } from "../turnCheckpoint.js";
import type { TurnBudgetCause } from "../turnRunner.js";

/** ADR-071 removed the old fixed cap; the emergency budget is the real bound. */
export const DEFAULT_MAX_CONTINUATIONS = Number.POSITIVE_INFINITY;
/** Total wall clock for one task chain, not one Turn slice. */
export const MAX_TASK_DURATION_MS = 24 * 60 * 60_000;
const MAX_CHAIN_DEPTH = 1_000;
const MAX_FALLBACK_GOAL_CHARS = 4_000;
const MAX_FALLBACK_ASSISTANT_CHARS = 8_000;

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

/**
 * Automatic continuation is still the same user-authorized task. Keep the
 * originating client session so command/process/service tools can pass their
 * execution-context checks; without it the next slice can only edit files.
 */
function turnClientSessionId(inputJson: string): string | undefined {
  try {
    const parsed = JSON.parse(inputJson) as {
      executionContext?: { clientSessionId?: unknown };
    };
    const value = parsed.executionContext?.clientSessionId;
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function hasModelCall(db: Database, turnId: string): boolean {
  return (
    db
      .select({ id: agentEvents.id })
      .from(agentEvents)
      .where(and(eq(agentEvents.turnId, turnId), eq(agentEvents.type, "model.usage")))
      .limit(1)
      .get() !== undefined
  );
}

function clip(value: string, maxChars: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxChars) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxChars)}…[${trimmed.length - maxChars} chars omitted]`;
}

/** How many turns already continue this one (the original turn is depth 0). */
function chainDepth(db: Database, turnId: string): number {
  let depth = 0;
  let current = getTurnById(db, turnId);

  while (current?.resumedFromTurnId != null && depth < MAX_CHAIN_DEPTH) {
    depth += 1;
    current = getTurnById(db, current.resumedFromTurnId);
  }

  return depth;
}

/** The original Turn's start; the 24h emergency bound covers the whole chain. */
function chainStartedAt(db: Database, turnId: string): number {
  let current = getTurnById(db, turnId);
  let startedAt = current?.createdAt ?? 0;
  let depth = 0;

  while (current?.resumedFromTurnId != null && depth < MAX_CHAIN_DEPTH) {
    const parent = getTurnById(db, current.resumedFromTurnId);

    if (parent === null) {
      break;
    }

    startedAt = parent.createdAt;
    current = parent;
    depth += 1;
  }

  return startedAt;
}

function latestAssistantText(db: Database, turnId: string): string | null {
  const row = db
    .select({ payloadJson: agentEvents.payloadJson })
    .from(agentEvents)
    .where(and(eq(agentEvents.turnId, turnId), eq(agentEvents.type, "assistant.message")))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();

  if (row === undefined) {
    return null;
  }

  try {
    const payload = JSON.parse(row.payloadJson) as { text?: unknown };
    return typeof payload.text === "string" && payload.text.trim().length > 0 ? payload.text : null;
  } catch {
    return null;
  }
}

/**
 * A context rollover can happen before any tool fact exists (pure reasoning or
 * an interrupted plan). The next Turn still needs a handover, so use the
 * original goal plus the last assistant message. The "Work state checkpoint"
 * prefix keeps the existing timeline grouping and is deliberately explicit
 * about the degraded handover.
 */
function fallbackCheckpointMessage(db: Database, turnId: string, goal: string): string | null {
  const lastAssistant = latestAssistantText(db, turnId);

  if (goal.trim().length === 0 && lastAssistant === null) {
    return null;
  }

  const parts = [
    "Work state checkpoint (fallback: no tool facts were recorded).",
    goal.trim().length === 0 ? "" : `Original goal:\n${clip(goal, MAX_FALLBACK_GOAL_CHARS)}`,
    lastAssistant === null
      ? ""
      : `Last assistant message:\n${clip(lastAssistant, MAX_FALLBACK_ASSISTANT_CHARS)}`,
    "Continue the task from this point. Re-check actual state before repeating actions.",
  ].filter((part) => part.length > 0);

  return parts.length > 1 ? parts.join("\n\n") : null;
}

function continuationContent(
  db: Database,
  turn: { id: string; inputJson: string },
  goal: string,
  now: number,
): string | null {
  const facts = loadTurnFacts(db, turn.id, goal);

  if (!factsAreEmpty(facts)) {
    return checkpointMessage(facts, now).content;
  }

  return fallbackCheckpointMessage(db, turn.id, goal);
}

/**
 * Continue a Turn that ended on a context rollover or an explicitly enabled
 * spend/context budget. ADR-071 makes rollover the normal path; the old
 * budget path remains for diagnostics and for callers that pin a cap.
 */
export function continueBudgetedTurn(
  options: { db: Database; maxContinuations?: number; now?: () => number },
  input: { turnId: string; budgetCause?: TurnBudgetCause },
): ContinuationResult | null {
  const maxContinuations = options.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const now = options.now?.() ?? Date.now();
  const turn = getTurnById(options.db, input.turnId);

  if (turn === null || turn.status !== "COMPLETED") {
    return null;
  }

  const isRollover = turn.terminalReason === "continued";
  const isBudget = turn.terminalReason === "budget";

  if (!isRollover && !isBudget) {
    return null;
  }

  // Spend and context pressure are continuable; duration/steps/tool calls are
  // emergency or explicit stops, not a request for another slice.
  if (
    isBudget &&
    input.budgetCause !== undefined &&
    input.budgetCause !== "tokens" &&
    input.budgetCause !== "context"
  ) {
    return null;
  }

  // A slice that stopped before its first model call proves the chain already
  // spent its cap: chaining again would only append empty turns.
  if (isBudget && input.budgetCause === "tokens" && spentTokensFromJson(turn.usageJson) === 0) {
    return null;
  }

  // Context pressure before any model call means the same unshrinkable input
  // would stop the next slice the same way. Continuing there is a no-progress
  // loop, not a useful handover.
  if (
    isBudget &&
    input.budgetCause === "context" &&
    spentTokensFromJson(turn.usageJson) === 0 &&
    !hasModelCall(options.db, turn.id)
  ) {
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

  if (now - chainStartedAt(options.db, turn.id) >= MAX_TASK_DURATION_MS) {
    return null;
  }

  const goal = turnGoal(turn.inputJson);
  const content = continuationContent(options.db, turn, goal, now);

  if (content === null) {
    return null;
  }

  let created: { turnId: string; status: string; sessionId: string };
  const clientSessionId = turnClientSessionId(turn.inputJson);

  try {
    created = createTurn(
      { db: options.db, now: () => now },
      {
        sessionId: turn.sessionId,
        text: content,
        attachmentIds: screenshotIds(turn.inputJson),
        model: turn.model,
        thinking: turn.thinking,
        credentialProfileId: turn.credentialProfileId,
        ...(clientSessionId === undefined ? {} : { clientSessionId }),
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
      payload: {
        turnId: created.turnId,
        fromTurnId: turn.id,
        depth: depth + 1,
        reason: isRollover ? "context_rollover" : (input.budgetCause ?? "budget"),
      },
      now,
    });
    appendAudit(tx, {
      action: "turn.continued",
      decision: "allow",
      sessionId: created.sessionId,
      resourceType: "turn",
      resourceId: created.turnId,
      details: {
        fromTurnId: turn.id,
        depth: depth + 1,
        reason: isRollover ? "context_rollover" : (input.budgetCause ?? "budget"),
      },
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
