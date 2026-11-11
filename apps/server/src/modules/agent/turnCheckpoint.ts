import type { ModelMessage } from "@larness/agent";
import { asc, desc, eq } from "drizzle-orm";
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

interface EventLike {
  type: string;
  payloadJson: string;
}

function payloadOf(event: EventLike): Record<string, unknown> {
  try {
    const parsed = JSON.parse(event.payloadJson) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Rebuild the facts of a finished Turn from its persisted events. Recovery uses
 * the same shape as the in-Turn checkpoint so both describe facts identically.
 */
export function extractFactsFromEvents(events: EventLike[], goal: string): CheckpointFacts {
  const facts = new TurnFactsBuilder(goal);
  const toolNames = new Map<string, string>();

  for (const event of events) {
    const payload = payloadOf(event);

    if (event.type === "tool.requested") {
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
      const name = typeof payload.name === "string" ? payload.name : undefined;

      if (toolCallId !== undefined && name !== undefined) {
        toolNames.set(toolCallId, name);
      }

      continue;
    }

    if (event.type === "tool.completed") {
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
      const toolName = toolCallId === undefined ? undefined : toolNames.get(toolCallId);

      if (toolName === "run_command" && typeof payload.resultSummary === "string") {
        facts.recordCommand(payload.resultSummary);
      }

      facts.recordResource(payload.resourceTarget);
      continue;
    }

    if (event.type === "file.changed") {
      if (typeof payload.path === "string" && typeof payload.version === "string") {
        facts.recordFile(payload.path, payload.version);
      }

      continue;
    }

    if (event.type === "tool.failed") {
      const errorCode = typeof payload.errorCode === "string" ? payload.errorCode : "TOOL_ERROR";
      const message = typeof payload.message === "string" ? payload.message : "";
      facts.recordToolFailure(errorCode, message);
      continue;
    }

    if (event.type === "plan.updated") {
      const plan = payload.plan;

      if (typeof plan === "object" && plan !== null) {
        const steps = (plan as { steps?: unknown }).steps;

        if (Array.isArray(steps)) {
          facts.recordPlan(
            steps.flatMap((step) => {
              if (typeof step !== "object" || step === null) {
                return [];
              }

              const record = step as { id?: unknown; title?: unknown; status?: unknown };

              return typeof record.id === "string" && typeof record.title === "string"
                ? [
                    {
                      id: record.id,
                      title: record.title,
                      status: String(record.status ?? "pending"),
                    },
                  ]
                : [];
            }),
          );
        }
      }
    }
  }

  return facts.snapshot();
}

export function loadTurnFacts(db: DbExecutor, turnId: string, goal: string): CheckpointFacts {
  const rows = db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.turnId, turnId))
    .orderBy(asc(agentEvents.seq))
    .all();

  return extractFactsFromEvents(rows, goal);
}

export function factsAreEmpty(facts: CheckpointFacts): boolean {
  return (
    facts.files.length === 0 &&
    facts.commands.length === 0 &&
    facts.failures.length === 0 &&
    facts.openSteps.length === 0 &&
    facts.resources.length === 0
  );
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
