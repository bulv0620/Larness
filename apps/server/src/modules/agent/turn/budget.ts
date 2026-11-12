import type { ProviderFinishReason, ProviderUsage } from "@larness/agent";
import type { TurnStatus, TurnTerminalReason } from "../../../db/schema.js";

export const DEFAULT_BUDGET = {
  maxSteps: 50,
  maxToolCalls: 50,
  maxDurationMs: 10 * 60_000,
  contextRatio: 0.8,
  // 0 = let the provider choose. A hard cap truncates thinking models, whose
  // reasoning tokens are charged against the same output budget.
  maxOutputTokens: 0,
  repeatFailureThreshold: 3,
  // 0 disables the spend cap until D10 confirms a default.
  maxTotalTokens: 0,
} as const;

export interface TurnBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  contextRatio: number;
  maxOutputTokens: number;
  repeatFailureThreshold: number;
  maxTotalTokens: number;
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
