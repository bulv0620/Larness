import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agentEvents, type TurnStatus, turns } from "../../db/schema.js";
import { SessionError } from "./errors.js";
import { getSessionById } from "./repository.js";

const TERMINAL_STATUSES: readonly TurnStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
];

export interface SessionCacheUsageDto {
  /** Cache hit share over requests that reported both read and miss tokens. */
  hitRate: number | null;
  readTokens: number;
  missTokens: number;
  knownRequests: number;
  unknownRequests: number;
}

export interface SessionUsageDto {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number | null;
  noCacheTokens: number | null;
  cache: SessionCacheUsageDto;
  /** Terminal Turns considered by the aggregate. */
  turns: number;
  /** Terminal Turns with no reported usage, or with at least one missing step. */
  missingTurns: number;
  partial: boolean;
  updatedAt: number | null;
}

interface UsageFields {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  noCacheTokens?: number;
  missingSteps?: number;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}

function parseUsage(json: string | null): UsageFields | null {
  if (json === null) return null;

  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed === null || typeof parsed !== "object") return null;
    return {
      ...(tokenCount(parsed.inputTokens) === undefined
        ? {}
        : { inputTokens: tokenCount(parsed.inputTokens) }),
      ...(tokenCount(parsed.outputTokens) === undefined
        ? {}
        : { outputTokens: tokenCount(parsed.outputTokens) }),
      ...(tokenCount(parsed.totalTokens) === undefined
        ? {}
        : { totalTokens: tokenCount(parsed.totalTokens) }),
      ...(tokenCount(parsed.cacheReadTokens) === undefined
        ? {}
        : { cacheReadTokens: tokenCount(parsed.cacheReadTokens) }),
      ...(tokenCount(parsed.noCacheTokens) === undefined
        ? {}
        : { noCacheTokens: tokenCount(parsed.noCacheTokens) }),
      ...(tokenCount(parsed.missingSteps) === undefined
        ? {}
        : { missingSteps: tokenCount(parsed.missingSteps) }),
    };
  } catch {
    return null;
  }
}

function hasTokens(usage: UsageFields | null): usage is UsageFields {
  return (
    usage !== null &&
    (usage.inputTokens !== undefined ||
      usage.outputTokens !== undefined ||
      usage.totalTokens !== undefined)
  );
}

/**
 * Cache hit rate is a per-request property: turn-level `usage_json` collapses
 * unknown and known steps together. Use the persisted `model.usage` events so
 * requests without provider cache fields are excluded from the denominator
 * instead of being counted as misses.
 */
function cacheUsageFromEvents(db: Database, sessionId: string): SessionCacheUsageDto {
  const rows = db
    .select({ payloadJson: agentEvents.payloadJson })
    .from(agentEvents)
    .where(and(eq(agentEvents.sessionId, sessionId), eq(agentEvents.type, "model.usage")))
    .all();

  let readTokens = 0;
  let missTokens = 0;
  let knownRequests = 0;
  let unknownRequests = 0;

  for (const row of rows) {
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.payloadJson) as unknown;
      if (parsed === null || typeof parsed !== "object") {
        unknownRequests += 1;
        continue;
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      unknownRequests += 1;
      continue;
    }

    const read = tokenCount(payload.cacheReadTokens);
    const reportedMiss = tokenCount(payload.noCacheTokens);
    const input = tokenCount(payload.inputTokens);
    if (read === undefined || payload.usageSource === "unknown") {
      unknownRequests += 1;
      continue;
    }

    const miss = reportedMiss ?? (input !== undefined && input >= read ? input - read : undefined);
    if (miss === undefined) {
      unknownRequests += 1;
      continue;
    }

    readTokens += read;
    missTokens += miss;
    knownRequests += 1;
  }

  const denominator = readTokens + missTokens;
  return {
    hitRate: knownRequests > 0 && denominator > 0 ? readTokens / denominator : null,
    readTokens,
    missTokens,
    knownRequests,
    unknownRequests,
  };
}

/**
 * Aggregates the provider usage already persisted on terminal Turns. Missing
 * values stay missing: the caller gets lower-bound sums plus an explicit
 * `partial` flag instead of a zero-filled total that looks measured.
 */
export function getSessionUsage(db: Database, sessionId: string): SessionUsageDto {
  if (getSessionById(db, sessionId) === null) {
    throw new SessionError("NOT_FOUND", "session not found");
  }

  const rows = db
    .select({
      status: turns.status,
      usageJson: turns.usageJson,
      endedAt: turns.endedAt,
    })
    .from(turns)
    .where(eq(turns.sessionId, sessionId))
    .all();

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let cacheReadTokens = 0;
  let noCacheTokens = 0;
  let cacheReadSeen = false;
  let cacheReadComplete = true;
  let noCacheSeen = false;
  let noCacheComplete = true;
  let considered = 0;
  let missingTurns = 0;
  let updatedAt: number | null = null;

  for (const row of rows) {
    if (!TERMINAL_STATUSES.includes(row.status)) continue;
    considered += 1;
    if (row.endedAt !== null && (updatedAt === null || row.endedAt > updatedAt)) {
      updatedAt = row.endedAt;
    }

    const usage = parseUsage(row.usageJson);
    if (!hasTokens(usage)) {
      missingTurns += 1;
      continue;
    }

    const incomplete =
      usage.inputTokens === undefined ||
      usage.outputTokens === undefined ||
      (usage.missingSteps !== undefined && usage.missingSteps > 0);
    if (incomplete) missingTurns += 1;

    inputTokens += usage.inputTokens ?? 0;
    outputTokens += usage.outputTokens ?? 0;
    totalTokens +=
      usage.totalTokens ??
      (usage.inputTokens !== undefined && usage.outputTokens !== undefined
        ? usage.inputTokens + usage.outputTokens
        : 0);

    if (usage.cacheReadTokens === undefined) cacheReadComplete = false;
    else {
      cacheReadSeen = true;
      cacheReadTokens += usage.cacheReadTokens;
    }

    if (usage.noCacheTokens === undefined) noCacheComplete = false;
    else {
      noCacheSeen = true;
      noCacheTokens += usage.noCacheTokens;
    }
  }

  return {
    sessionId,
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens: cacheReadSeen && cacheReadComplete ? cacheReadTokens : null,
    noCacheTokens: noCacheSeen && noCacheComplete ? noCacheTokens : null,
    cache: cacheUsageFromEvents(db, sessionId),
    turns: considered,
    missingTurns,
    partial: missingTurns > 0,
    updatedAt,
  };
}
