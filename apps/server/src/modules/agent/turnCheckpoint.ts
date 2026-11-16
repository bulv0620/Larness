import type { ModelImage, ModelMessage } from "@larness/agent";
import { asc, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { agentEvents, sessionContextSummaries } from "../../db/schema.js";

/** Bounded so a checkpoint can never become the new overflow problem. */
export const MAX_CHECKPOINT_CHARS = 4_000;
/**
 * The current request is pinned next to the checkpoint. It used to survive only
 * as `goal`, truncated to 600 characters, so a long specification silently lost
 * its second half at the first compaction with no event and no UI hint.
 */
export const MAX_PINNED_REQUEST_CHARS = 8_000;
const MAX_FILES = 20;
const MAX_COMMANDS = 12;
const MAX_FAILURES = 8;
const MAX_RESOURCES = 12;
const MAX_OPEN_STEPS = 20;
const MAX_GOAL_CHARS = 600;
const MAX_PATH_CHARS = 200;
const MAX_VERSION_CHARS = 80;

export interface CheckpointFacts {
  goal: string;
  files: { path: string; version: string }[];
  /**
   * Files that were only inspected. Successful read-only tools used to record
   * nothing, so a read-only Turn had empty facts: it could be neither compacted
   * nor continued and simply stopped on the context budget.
   */
  reads: { path: string; version: string }[];
  commands: string[];
  failures: string[];
  openSteps: string[];
  resources: string[];
}

interface CheckpointLimits {
  files: number;
  reads: number;
  commands: number;
  failures: number;
  openSteps: number;
  resources: number;
  textChars: number;
}

/**
 * Fidelity ladder. The checkpoint is shaped field by field instead of being cut
 * out of serialized JSON: a character cut produced invalid JSON and always ate
 * the trailing sections (`resources` first), which is exactly the loss the
 * tool-result shaper already forbids.
 */
function limits(
  files: number,
  reads: number,
  commands: number,
  failures: number,
  openSteps: number,
  resources: number,
  textChars: number,
): CheckpointLimits {
  return { files, reads, commands, failures, openSteps, resources, textChars };
}

const CHECKPOINT_LADDER: CheckpointLimits[] = [
  limits(MAX_FILES, MAX_FILES, MAX_COMMANDS, MAX_FAILURES, MAX_OPEN_STEPS, MAX_RESOURCES, 240),
  limits(12, 12, 8, 6, 12, 12, 200),
  limits(8, 8, 5, 4, 8, 10, 160),
  limits(4, 4, 2, 2, 4, 8, 120),
  limits(2, 2, 1, 1, 2, 6, 80),
];

function clipText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const omitted = value.length - maxChars;
  const headChars = Math.max(1, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(0, maxChars - headChars);
  const tail = tailChars === 0 ? "" : value.slice(-tailChars);

  return `${value.slice(0, headChars)}…[${omitted} chars omitted]…${tail}`;
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
  readonly #reads = new Map<string, string>();
  readonly #commands: string[] = [];
  readonly #failures: string[] = [];
  readonly #resources = new Set<string>();
  #plan: PlanStepLike[] = [];

  constructor(goal: string) {
    this.#goal = goal.trim().slice(0, MAX_GOAL_CHARS);
  }

  recordFile(filePath: string, version: string): void {
    this.#files.set(filePath, version);
    // A written file is already tracked with its new version.
    this.#reads.delete(filePath);
  }

  recordRead(filePath: string, version: string): void {
    if (!this.#files.has(filePath)) {
      this.#reads.set(filePath, version);
    }
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
      this.#reads.size === 0 &&
      this.#commands.length === 0 &&
      this.#failures.length === 0 &&
      this.#plan.length === 0 &&
      this.#resources.size === 0
    );
  }

  snapshot(): CheckpointFacts {
    const entriesOf = (source: Map<string, string>) =>
      [...source.entries()].slice(-MAX_FILES).map(([filePath, version]) => ({
        path: filePath,
        version,
      }));

    return {
      goal: this.#goal,
      files: entriesOf(this.#files),
      reads: entriesOf(this.#reads),
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

interface ShapedFacts {
  goal: string;
  files: { path: string; version: string }[];
  reads: { path: string; version: string }[];
  commands: string[];
  failures: string[];
  openSteps: string[];
  resources: string[];
  omitted?: Record<string, number>;
}

function shapeFiles(
  entries: { path: string; version: string }[],
  limit: number,
): { kept: { path: string; version: string }[]; omitted: number } {
  const kept = entries.slice(-limit).map((entry) => ({
    path: clipText(entry.path, MAX_PATH_CHARS),
    version: clipText(entry.version, MAX_VERSION_CHARS),
  }));

  return { kept, omitted: Math.max(0, entries.length - kept.length) };
}

function shapeTexts(
  values: string[],
  limit: number,
  chars: number,
): { kept: string[]; omitted: number } {
  const kept = values.slice(-limit).map((value) => clipText(value, chars));

  return { kept, omitted: Math.max(0, values.length - kept.length) };
}

function shapeFacts(facts: CheckpointFacts, level: CheckpointLimits): ShapedFacts {
  const files = shapeFiles(facts.files, level.files);
  const reads = shapeFiles(facts.reads, level.reads);
  const commands = shapeTexts(facts.commands, level.commands, level.textChars);
  const failures = shapeTexts(facts.failures, level.failures, level.textChars);
  const openSteps = shapeTexts(facts.openSteps, level.openSteps, level.textChars);
  const resources = shapeTexts(facts.resources, level.resources, MAX_PATH_CHARS);
  const counts: [string, number][] = [
    ["files", files.omitted],
    ["reads", reads.omitted],
    ["commands", commands.omitted],
    ["failures", failures.omitted],
    ["openSteps", openSteps.omitted],
    ["resources", resources.omitted],
  ];
  const omitted = Object.fromEntries(counts.filter(([, count]) => count > 0));

  return {
    goal: facts.goal,
    files: files.kept,
    reads: reads.kept,
    commands: commands.kept,
    failures: failures.kept,
    openSteps: openSteps.kept,
    resources: resources.kept,
    ...(Object.keys(omitted).length === 0 ? {} : { omitted }),
  };
}

/**
 * Serializes the facts at the highest fidelity that fits the budget, so the
 * body is always valid JSON and loss is explicit in `omitted` counts instead of
 * silently dropping the trailing fields.
 */
export function boundedCheckpointBody(facts: CheckpointFacts): string {
  const smallest = CHECKPOINT_LADDER[CHECKPOINT_LADDER.length - 1] as CheckpointLimits;

  for (const level of CHECKPOINT_LADDER) {
    const body = JSON.stringify(shapeFacts(facts, level));

    if (body.length <= MAX_CHECKPOINT_CHARS) {
      return body;
    }
  }

  return JSON.stringify(shapeFacts(facts, smallest));
}

export function checkpointMessage(facts: CheckpointFacts, observedAt: number): ModelMessage {
  const bounded = boundedCheckpointBody(facts);

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

/**
 * The request that opened the Turn, kept verbatim across compaction. Without it
 * a long specification is reduced to the checkpoint's 600-character `goal` and
 * the model keeps working against a requirement it can no longer read.
 */
export function pinnedRequestMessage(input: {
  text: string;
  images?: ModelImage[];
}): ModelMessage | null {
  const text = input.text.trim();
  const images = input.images ?? [];

  if (text.length === 0 && images.length === 0) {
    return null;
  }

  const omitted = Math.max(0, text.length - MAX_PINNED_REQUEST_CHARS);
  const body =
    omitted === 0
      ? text
      : `${text.slice(0, MAX_PINNED_REQUEST_CHARS)}…[${omitted} chars omitted; re-read the requirement from the user or a project file before assuming the rest]…`;

  return {
    role: "user",
    content: [
      "Original request for this Turn (kept verbatim when older messages were compacted):",
      body,
    ].join("\n"),
    ...(images.length === 0 ? {} : { images }),
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

      const read = payload.fileRead;

      if (typeof read === "object" && read !== null) {
        const record = read as { path?: unknown; version?: unknown };

        if (typeof record.path === "string" && typeof record.version === "string") {
          facts.recordRead(record.path, record.version);
        }
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
    facts.reads.length === 0 &&
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
