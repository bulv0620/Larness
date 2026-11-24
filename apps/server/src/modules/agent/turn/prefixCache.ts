import { createHash } from "node:crypto";
import type { ToolSchema } from "@larness/agent";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import { agentEvents } from "../../../db/schema.js";

/**
 * Why the provider could not reuse the previous request's cached prefix.
 * The classifier only uses client-side facts; `provider_eviction` is the one
 * case that infers a server-side cause, and it never changes behaviour.
 */
export const PREFIX_BREAK_REASONS = [
  "none",
  "cold",
  "prompt_version",
  "instructions",
  "tools",
  "history_drop",
  "compacted",
  "model_switch",
  "provider_eviction",
  "unknown",
] as const;

export type PrefixBreakReason = (typeof PREFIX_BREAK_REASONS)[number];

export type PrefixBreakAt = "system" | "instructions" | "tools" | "history" | "model";

export interface PrefixBreak {
  reason: PrefixBreakReason;
  /** Affected segment; null when the reason is `none`. */
  at: PrefixBreakAt | null;
}

/**
 * One request's prefix identity. Only enums, counts and 12-hex hashes are ever
 * persisted — never prompt text, memories, tool arguments or tool output.
 */
export interface PrefixSnapshot {
  promptVersion: string;
  systemHash: string;
  instructionsHash: string;
  toolsetHash: string;
  model: string;
  firstHistorySeq: number | null;
  prefixKeptTokens: number;
  /** Provider-reported cache reads, used only for the eviction heuristic. */
  cacheReadTokens?: number;
  /** Assembled from a persisted session summary rather than raw history. */
  compacted?: boolean;
  /** The token budget dropped history during this assembly. */
  historyTrimmed?: boolean;
}

/** A drop this large is worth reporting; smaller noise stays `none`. */
export const PROVIDER_EVICTION_MIN_TOKENS = 2_000;
export const PROVIDER_EVICTION_MIN_RATIO = 0.05;

const SHORT_HASH_CHARS = 12;

export function shortHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, SHORT_HASH_CHARS);
}

export function toolsetHash(tools: ToolSchema[]): string {
  return shortHash(
    tools.map((tool) => `${tool.name}:${JSON.stringify(tool.parameters)}`).join("\n"),
  );
}

export function prefixSnapshot(input: {
  promptVersion: string;
  systemCore: string;
  instructions: string;
  tools: ToolSchema[];
  model: string;
  firstHistorySeq: number | null;
  prefixTokens: number;
  compacted?: boolean;
  historyTrimmed?: boolean;
  cacheReadTokens?: number;
}): PrefixSnapshot {
  return {
    promptVersion: input.promptVersion,
    systemHash: shortHash(input.systemCore),
    instructionsHash: shortHash(input.instructions),
    toolsetHash: toolsetHash(input.tools),
    model: input.model,
    firstHistorySeq: input.firstHistorySeq,
    prefixKeptTokens: Math.max(0, Math.trunc(input.prefixTokens)),
    ...(input.compacted === undefined ? {} : { compacted: input.compacted }),
    ...(input.historyTrimmed === undefined ? {} : { historyTrimmed: input.historyTrimmed }),
    ...(input.cacheReadTokens === undefined ? {} : { cacheReadTokens: input.cacheReadTokens }),
  };
}

function isEviction(previous: PrefixSnapshot, current: PrefixSnapshot): boolean {
  if (previous.cacheReadTokens === undefined || current.cacheReadTokens === undefined) {
    return false;
  }

  const drop = previous.cacheReadTokens - current.cacheReadTokens;

  return (
    drop > PROVIDER_EVICTION_MIN_TOKENS &&
    previous.cacheReadTokens > 0 &&
    drop / previous.cacheReadTokens > PROVIDER_EVICTION_MIN_RATIO
  );
}

/**
 * Deterministic prefix attribution. `pending` wins because a mid-Turn
 * checkpoint rewrites messages in ways the segment hashes cannot see.
 */
export function classifyPrefixBreak(input: {
  previous: PrefixSnapshot | null;
  current: PrefixSnapshot;
  pending?: PrefixBreak | null;
}): PrefixBreak {
  if (input.pending !== undefined && input.pending !== null) {
    return input.pending;
  }

  const { previous, current } = input;

  if (previous === null) {
    return { reason: "cold", at: "system" };
  }

  if (previous.model !== current.model) {
    return { reason: "model_switch", at: "model" };
  }

  if (previous.promptVersion !== current.promptVersion) {
    return { reason: "prompt_version", at: "system" };
  }

  if (previous.systemHash !== current.systemHash) {
    // The version is the contract that makes this explainable; a changed core
    // without a bump is a bug, not a user-visible instruction change.
    return { reason: "unknown", at: "system" };
  }

  if (previous.instructionsHash !== current.instructionsHash) {
    return { reason: "instructions", at: "instructions" };
  }

  if (previous.toolsetHash !== current.toolsetHash) {
    return { reason: "tools", at: "tools" };
  }

  const previousFirst = previous.firstHistorySeq;
  const currentFirst = current.firstHistorySeq;

  if (previousFirst !== null && currentFirst !== null && currentFirst > previousFirst) {
    return current.historyTrimmed === true
      ? { reason: "history_drop", at: "history" }
      : current.compacted === true
        ? { reason: "compacted", at: "history" }
        : { reason: "history_drop", at: "history" };
  }

  if (isEviction(previous, current)) {
    return { reason: "provider_eviction", at: "history" };
  }

  return { reason: "none", at: null };
}

function hexHash(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{12}$/.test(value) ? value : null;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

/**
 * Reads the last request's prefix identity. Older events predate the
 * diagnostic fields, so they read as "no baseline" (cold) instead of being
 * guessed from text.
 */
export function readPreviousPrefix(db: Database, sessionId: string): PrefixSnapshot | null {
  const row = db
    .select({ payloadJson: agentEvents.payloadJson })
    .from(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), eq(agentEvents.type, "model.usage")))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();

  if (row === undefined) return null;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(row.payloadJson) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    payload = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const promptVersion = typeof payload.promptVersion === "string" ? payload.promptVersion : null;
  const systemHash = hexHash(payload.systemHash);
  const instructionsHash = hexHash(payload.instructionsHash);
  const toolsetHashValue = hexHash(payload.toolsetHash);
  const model = typeof payload.model === "string" ? payload.model : null;
  const prefixKeptTokens = tokenCount(payload.prefixKeptTokens);

  if (
    promptVersion === null ||
    systemHash === null ||
    instructionsHash === null ||
    toolsetHashValue === null ||
    model === null ||
    prefixKeptTokens === undefined
  ) {
    return null;
  }

  const firstHistorySeq = tokenCount(payload.firstHistorySeq);

  return {
    promptVersion,
    systemHash,
    instructionsHash,
    toolsetHash: toolsetHashValue,
    model,
    firstHistorySeq: firstHistorySeq ?? null,
    prefixKeptTokens,
    ...(tokenCount(payload.cacheReadTokens) === undefined
      ? {}
      : { cacheReadTokens: tokenCount(payload.cacheReadTokens) }),
  };
}
