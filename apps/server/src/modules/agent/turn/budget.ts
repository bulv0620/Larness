import type { ProviderFinishReason, ProviderUsage } from "@larness/agent";
import type { TurnStatus, TurnTerminalReason } from "../../../db/schema.js";

/**
 * Window multiple used for the adaptive spend cap.
 *
 * Every step re-sends the whole history, so a fixed token cap buys fewer and
 * fewer steps as the model window grows: 2M tokens is ~20 steps on a 100k
 * context and ~10 steps on a 200k context. Scaling the cap with the window
 * keeps the number of useful steps roughly constant instead of punishing
 * large-context models (ADR-059).
 */
export const SPEND_CAP_CONTEXTS = 30;

/**
 * Wall clock is only a stall guard (ADR-059). It was raised from 60 to 180
 * minutes because the spend cap — not the clock — is the real budget: a
 * chatty coding loop exhausts `contextWindow × 30` in well under an hour,
 * while verification-heavy Turns (builds, e2e, `install`) spend most of
 * their time waiting with a small context and were being cut mid-work.
 */
export const DEFAULT_MAX_DURATION_MS = 180 * 60_000;

export const DEFAULT_BUDGET = {
  // 0 = no step cap. A turn runs until it finishes or hits the spend cap;
  // wall clock is only a stall guard (ADR-059, option A).
  maxSteps: 0,
  maxToolCalls: 0,
  maxDurationMs: DEFAULT_MAX_DURATION_MS,
  contextRatio: 0.8,
  // 0 = let the provider choose. A hard cap truncates thinking models, whose
  // reasoning tokens are charged against the same output budget.
  maxOutputTokens: 0,
  repeatFailureThreshold: 3,
  /**
   * Absolute spend cap in tokens. `> 0` wins over the adaptive default;
   * `<= 0` means "derive from the model window" (see `resolveSpendCap`).
   */
  maxTotalTokens: 0,
  /** Windows of spend allowed when `maxTotalTokens` is not set. 0 disables the cap. */
  spendCapContexts: SPEND_CAP_CONTEXTS,
} as const;

export interface TurnBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  contextRatio: number;
  maxOutputTokens: number;
  repeatFailureThreshold: number;
  maxTotalTokens: number;
  spendCapContexts: number;
}

/**
 * Resolves the per-turn spend cap in tokens. An explicit `maxTotalTokens`
 * always wins, so an operator (or a test) can still pin an exact number.
 * Otherwise the cap scales with the window the provider reported for this
 * turn. A result of `0` means the cap is disabled.
 */
export function resolveSpendCap(
  budget: Pick<TurnBudget, "maxTotalTokens" | "spendCapContexts">,
  contextWindow: number,
): number {
  if (budget.maxTotalTokens > 0) {
    return budget.maxTotalTokens;
  }

  if (budget.spendCapContexts <= 0 || contextWindow <= 0) {
    return 0;
  }

  return Math.floor(contextWindow * budget.spendCapContexts);
}

export function deriveTerminalReason(
  status: TurnStatus,
  options: { budgetExhausted?: boolean; finishReason?: ProviderFinishReason; errorCode?: string },
): TurnTerminalReason {
  if (status === "CANCELLED") {
    return "cancelled";
  }

  if (status === "INTERRUPTED") {
    return "interrupted";
  }

  if (status === "COMPLETED") {
    if (options.budgetExhausted === true) {
      return "budget";
    }

    return options.finishReason === "length" ? "output_truncated" : "normal";
  }

  return options.errorCode?.startsWith("PROVIDER_") === true ? "provider_error" : "error";
}

function addKnownTokens(total: number | undefined, next: number | undefined): number | undefined {
  return total === undefined || next === undefined ? undefined : total + next;
}

export function addUsage(total: ProviderUsage, next: ProviderUsage | undefined): ProviderUsage {
  if (next === undefined) {
    return total;
  }

  const started =
    total.inputTokens !== undefined ||
    total.outputTokens !== undefined ||
    total.totalTokens !== undefined ||
    total.cacheReadTokens !== undefined ||
    total.noCacheTokens !== undefined;

  if (!started) {
    return { ...next };
  }

  // Cache usage stays unknown once any step fails to report it, so a partial
  // sum is never presented as a measured hit rate.
  const cacheReadTokens = addKnownTokens(total.cacheReadTokens, next.cacheReadTokens);
  const noCacheTokens = addKnownTokens(total.noCacheTokens, next.noCacheTokens);

  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (next.totalTokens ?? 0),
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(noCacheTokens === undefined ? {} : { noCacheTokens }),
  };
}
