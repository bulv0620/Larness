import type { ModelMessage } from "@larness/agent";
import { desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { agentEvents, sessionContextSummaries } from "../../db/schema.js";

/** Bounded so a checkpoint can never become the new overflow problem. */
export const MAX_CHECKPOINT_CHARS = 4_000;
const MAX_FILES = 20;
const MAX_COMMANDS = 12;
const MAX_FAILURES = 8;
const MAX_RESOURCES = 12;
const MAX_OPEN_STEPS = 20;
const MAX_GOAL_CHARS = 600;

export interface CheckpointFacts {
  goal: string;
  files: { path: string; version: string }[];
  commands: string[];
  failures: string[];
  openSteps: string[];
  resources: string[];
}

interface PlanStepLike {
  id: string;
  title: string;
  status: string;
}

function cap<T>(values: T[], limit: number): T[] {
  return values.length <= limit ? values : values.slice(values.length - limit);
}

function uniqueLast(values: string[], limit: number): string[] {
  return cap([...new Set(values)], limit);
}

/**
 * Collects verified engineering facts while a Turn runs. Facts mirror what was
 * already persisted as events; the checkpoint only compacts the message history,
 * it never becomes the source of truth.
 */
export class TurnFactsBuilder {
  readonly #goal: string;
  readonly #files = new Map<string, string>();
  readonly #commands: string[] = [];
  readonly #failures: string[] = [];
  readonly #resources = new Set<string>();
  #plan: PlanStepLike[] = [];

  constructor(goal: string) {
    this.#goal = goal.trim().slice(0, MAX_GOAL_CHARS);
  }

  recordFile(filePath: string, version: string): void {
    this.#files.set(filePath, version);
  }

  recordCommand(summary: string): void {
    this.#commands.push(summary);
  }

  recordToolFailure(errorCode: string, message: string): void {
    this.#failures.push(`${errorCode}: ${message}`);
  }

  recordPlan(steps: PlanStepLike[]): void {
    this.#plan = steps;
  }

  recordResource(target: unknown): void {
    if (typeof target !== "object" || target === null) {
      return;
    }

    const record = target as { kind?: unknown; serviceId?: unknown; terminalId?: unknown };

    if (typeof record.serviceId === "string") {
      this.#resources.add(record.serviceId);
    }

    if (typeof record.terminalId === "string") {
      this.#resources.add(record.terminalId);
    }
  }

  isEmpty(): boolean {
    return (
      this.#files.size === 0 &&
      this.#commands.length === 0 &&
      this.#failures.length === 0 &&
      this.#plan.length === 0 &&
      this.#resources.size === 0
    );
  }

  snapshot(): CheckpointFacts {
    const files = [...this.#files.entries()].slice(-MAX_FILES).map(([filePath, version]) => ({
      path: filePath,
      version,
    }));

    return {
      goal: this.#goal,
      files,
      commands: cap(this.#commands, MAX_COMMANDS),
      failures: uniqueLast(this.#failures, MAX_FAILURES),
      openSteps: this.#plan
        .filter((step) => step.status !== "done")
        .slice(0, MAX_OPEN_STEPS)
        .map((step) => `${step.id}: ${step.title} (${step.status})`),
      resources: uniqueLast([...this.#resources], MAX_RESOURCES),
    };
  }
}

export function checkpointMessage(facts: CheckpointFacts, observedAt: number): ModelMessage {
  const body = JSON.stringify(facts);
  const bounded =
    body.length <= MAX_CHECKPOINT_CHARS
      ? body
      : `${body.slice(0, MAX_CHECKPOINT_CHARS)}…[checkpoint truncated]`;

  return {
    role: "user",
    content: [
      `Work state checkpoint (verified facts, observed at ${observedAt}). Earlier messages were compacted to keep the Turn inside its context window.`,
      "Continue from these facts. Re-check actual state before repeating a write, command or deployment; the facts describe what was observed, not what is true now.",
      "",
      bounded,
    ].join("\n"),
  };
}

export function latestEventSeq(db: DbExecutor, sessionId: string): number {
  const row = db
    .select({ seq: agentEvents.seq })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId))
    .orderBy(desc(agentEvents.seq))
    .limit(1)
    .get();

  return row?.seq ?? 0;
}

export interface SavedCheckpoint {
  id: string;
  coveredUpToSeq: number;
}

export function saveTurnCheckpoint(
  db: DbExecutor,
  options: {
    sessionId: string;
    turnId: string;
    coveredUpToSeq: number;
    summary: string;
    tokensBefore: number;
    tokensAfter: number;
    degraded: boolean;
    reason: string;
    now: number;
  },
): SavedCheckpoint {
  const id = newId("sum");

  db.insert(sessionContextSummaries)
    .values({
      id,
      sessionId: options.sessionId,
      coveredUpToSeq: options.coveredUpToSeq,
      scope: "turn",
      turnId: options.turnId,
      reason: options.reason,
      summary: options.summary,
      tokensBefore: options.tokensBefore,
      tokensAfter: options.tokensAfter,
      degraded: options.degraded ? 1 : 0,
      createdAt: options.now,
    })
    .run();

  return { id, coveredUpToSeq: options.coveredUpToSeq };
}
