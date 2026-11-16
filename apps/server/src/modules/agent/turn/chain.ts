import type { Database } from "../../../db/client.js";
import { getTurnById } from "../../sessions/repository.js";

/** A chain is a handful of slices; the bound only guards against bad data. */
const MAX_CHAIN_DEPTH = 32;

/**
 * Input + output tokens one settled slice reported.
 *
 * Every step re-sends the whole history, so this is the only meaningful unit of
 * "how much work a slice already bought". A slice that never reached its first
 * model call reports nothing and counts as zero.
 */
export function sliceSpendTokens(usage: unknown): number {
  if (usage === null || typeof usage !== "object") {
    return 0;
  }

  const { inputTokens, outputTokens } = usage as { inputTokens?: unknown; outputTokens?: unknown };
  const input = typeof inputTokens === "number" ? inputTokens : 0;
  const output = typeof outputTokens === "number" ? outputTokens : 0;
  return input + output;
}

/** Same as `sliceSpendTokens` for the raw `usage_json` column. */
export function spentTokensFromJson(usageJson: string | null): number {
  if (usageJson === null) {
    return 0;
  }

  try {
    return sliceSpendTokens(JSON.parse(usageJson) as unknown);
  } catch {
    return 0;
  }
}

/**
 * Tokens the slices before this one already spent (ADR-059).
 *
 * The spend cap is a per-task limit, not a per-slice allowance: a continuation
 * that starts from a fresh cap would multiply the real ceiling by the number of
 * slices in the chain. Walking `resumedFromTurnId` makes the cap hold across the
 * whole task, so a long chain stops on total spend instead of restarting the
 * counter every time.
 */
export function carriedSpendTokens(db: Database, fromTurnId: string | null): number {
  let total = 0;
  let current = fromTurnId === null ? null : getTurnById(db, fromTurnId);
  let depth = 0;

  while (current !== null && depth < MAX_CHAIN_DEPTH) {
    total += spentTokensFromJson(current.usageJson);
    current =
      current.resumedFromTurnId === null ? null : getTurnById(db, current.resumedFromTurnId);
    depth += 1;
  }

  return total;
}
