import { createHash } from "node:crypto";
import type {
  ErrorCode,
  MemoryBudget,
  MemoryChangedPayload,
  MemoryDto,
  RememberInput,
  RememberToolInput,
} from "@larness/shared";
import { DEFAULT_PROJECT_ID } from "@larness/shared";
import { and, desc, eq, inArray, like, lt, or } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type {
  AgentEventRow,
  MemoryEvidenceKind,
  MemoryKind,
  MemoryRow,
  MemoryScope,
  MemoryStatus,
  ProjectRow,
  SessionRow,
  TurnRow,
} from "../../db/schema.js";
import { agentEvents, memories } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getProjectById } from "../projects/repository.js";
import { parseProjectSettings } from "../projects/service.js";
import { getSessionById, getTurnById } from "../sessions/repository.js";
import {
  evictionOrder,
  isMemoryStale,
  limitsFor,
  MEMORY_AUTO_CONFIDENCE_GLOBAL,
  MEMORY_AUTO_CONFIDENCE_PROJECT,
  MEMORY_EVICTED_RESTORE_MS,
  MEMORY_SUPPRESSION_RETENTION_MS,
  memoryBytes,
} from "./budget.js";
import { memoryContentVerdict } from "./content.js";
import {
  activeMemoryByKey,
  activeMemoryRows,
  countMemoryRowsByStatuses,
  countRevisionRows,
  deleteMemoryRow,
  expireDueMemoryRows,
  incrementMemoryUsage,
  insertMemoryRow,
  insertRevisionRow,
  listMemoryRows,
  listRevisionRows,
  memoryById,
  memoryRowsByStatuses,
  sumMemoryBytes,
  sumRevisionBytes,
  sumSuppressionBytes,
  suppressionByBodyHash,
  suppressionByKey,
  updateMemoryRow,
  upsertSuppressionRow,
} from "./repository.js";
import { purgeMemoryRetention, trimRevisions } from "./retention.js";

export class MemoryError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.details = details;
  }
}

export interface MemoryServiceOptions {
  db: Database;
  now?: () => number;
  enabled?: () => boolean;
  publish?: (payload: MemoryChangedPayload) => void;
}

export interface MemoryListQuery {
  status?: MemoryStatus;
  kind?: MemoryKind;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryListResult {
  items: MemoryDto[];
  total: number;
  budget: MemoryBudget;
}

export interface MemoryReadResult {
  items: MemoryDto[];
  truncated: boolean;
}

export interface MemoryContext {
  session: SessionRow;
  turn: TurnRow;
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body.trim()).digest("hex");
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function clampLimit(value: number | undefined, fallback = 100, max = 200): number {
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), max);
}

function normalizeStatus(status: string | undefined): MemoryStatus {
  const allowed: MemoryStatus[] = [
    "active",
    "review",
    "rejected",
    "superseded",
    "expired",
    "evicted",
  ];
  return allowed.includes(status as MemoryStatus) ? (status as MemoryStatus) : "active";
}

function normalizeKind(kind: string | undefined): MemoryKind | undefined {
  const allowed: MemoryKind[] = ["fact", "command", "gotcha", "decision", "preference"];
  return allowed.includes(kind as MemoryKind) ? (kind as MemoryKind) : undefined;
}

function evidenceMatchesKind(kind: MemoryKind, evidence: MemoryEvidenceKind): boolean {
  if (kind === "command") return evidence === "command_succeeded";
  if (kind === "gotcha") return evidence === "failure_then_success";
  if (kind === "fact")
    return (
      evidence === "file_observed" ||
      evidence === "command_succeeded" ||
      evidence === "user_statement"
    );
  if (kind === "decision") return true;
  return evidence === "user_statement" || evidence === "agent_inference";
}

function kindRank(kind: MemoryKind): number {
  return ["decision", "gotcha", "command", "fact", "preference"].indexOf(kind);
}

export class MemoryService {
  readonly #db: Database;
  readonly #now: () => number;
  readonly #enabled: () => boolean;
  readonly #publish: (payload: MemoryChangedPayload) => void;

  constructor(options: MemoryServiceOptions) {
    this.#db = options.db;
    this.#now = options.now ?? Date.now;
    this.#enabled = options.enabled ?? (() => true);
    this.#publish = options.publish ?? (() => {});
  }

  project(projectId: string): ProjectRow {
    if (projectId === DEFAULT_PROJECT_ID) {
      throw new MemoryError(
        "MEMORY_SCOPE_FORBIDDEN",
        "the default workspace has no project memory",
      );
    }

    const project = getProjectById(this.#db, projectId);

    if (project === null) {
      throw new MemoryError("MEMORY_NOT_FOUND", "project not found");
    }

    return project;
  }

  #assertEnabled(project: ProjectRow | null): void {
    if (!this.#enabled()) {
      throw new MemoryError("MEMORY_DISABLED", "memory is disabled");
    }

    if (project !== null && !parseProjectSettings(project.settingsJson).memory.enabled) {
      throw new MemoryError("MEMORY_DISABLED", "project memory is disabled");
    }
  }

  #projectKey(scope: MemoryScope, projectId: string | null): string {
    if (scope === "global") return "";
    if (projectId === null) {
      throw new MemoryError("MEMORY_SCOPE_FORBIDDEN", "project memory requires a project");
    }
    return projectId;
  }

  #toDto(row: MemoryRow, now: number): MemoryDto {
    return {
      id: row.id,
      scope: row.scope,
      projectId: row.projectId,
      kind: row.kind,
      key: row.key,
      title: row.title,
      body: row.body,
      status: row.status,
      confidence: row.confidence,
      evidenceKind: row.evidenceKind,
      sourceTurnId: row.sourceTurnId,
      sourceEventSeq: row.sourceEventSeq,
      createdBy: row.createdBy,
      useCount: row.useCount,
      lastUsedAt: row.lastUsedAt,
      lastConfirmedAt: row.lastConfirmedAt,
      correctionCount: row.correctionCount,
      pinned: row.pinned,
      bytes: row.bytes,
      verifiedAt: row.verifiedAt,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      stale: isMemoryStale(row, now),
      revisionCount: countRevisionRows(this.#db, row.id),
    };
  }

  budget(scope: MemoryScope, projectId: string | null): MemoryBudget {
    const project = scope === "project" ? this.project(projectId ?? "") : null;
    this.#assertEnabled(project);
    const projectKey = this.#projectKey(scope, projectId);
    const limits = limitsFor(scope);

    return {
      scope,
      projectId: scope === "project" ? projectKey : null,
      activeBytes: sumMemoryBytes(this.#db, scope, projectKey, ["active"]),
      totalBytes:
        sumMemoryBytes(this.#db, scope, projectKey) +
        sumRevisionBytes(this.#db, scope, projectKey) +
        sumSuppressionBytes(this.#db, scope, projectKey),
      activeCount: countMemoryRowsByStatuses(this.#db, scope, projectKey, ["active"]),
      reviewCount: countMemoryRowsByStatuses(this.#db, scope, projectKey, ["review"]),
      evictedCount: countMemoryRowsByStatuses(this.#db, scope, projectKey, ["evicted"]),
      limits,
    };
  }

  listProject(projectId: string, query: MemoryListQuery = {}): MemoryListResult {
    const project = this.project(projectId);
    this.#assertEnabled(project);
    expireDueMemoryRows(this.#db, this.#now());
    return this.#list("project", projectId, query);
  }

  listGlobal(query: MemoryListQuery = {}): MemoryListResult {
    this.#assertEnabled(null);
    expireDueMemoryRows(this.#db, this.#now());
    return this.#list("global", null, query);
  }

  #list(scope: MemoryScope, projectId: string | null, query: MemoryListQuery): MemoryListResult {
    const projectKey = this.#projectKey(scope, projectId);
    const status = normalizeStatus(query.status);
    const kind = normalizeKind(query.kind);
    const limit = clampLimit(query.limit);
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
    const rows = listMemoryRows(this.#db, {
      scope,
      projectKey,
      status,
      ...(kind === undefined ? {} : { kind }),
      ...(query.q === undefined ? {} : { q: query.q }),
      limit,
      offset,
    });
    const total = listMemoryRows(this.#db, {
      scope,
      projectKey,
      status,
      ...(kind === undefined ? {} : { kind }),
      ...(query.q === undefined ? {} : { q: query.q }),
      limit: 10_000,
      offset: 0,
    }).length;
    const now = this.#now();

    return {
      items: rows.map((row) => this.#toDto(row, now)),
      total,
      budget: this.budget(scope, projectId),
    };
  }

  #eventBySeq(db: DbExecutor, sessionId: string, seq: number): AgentEventRow | null {
    return (
      db
        .select()
        .from(agentEvents)
        .where(and(eq(agentEvents.sessionId, sessionId), eq(agentEvents.seq, seq)))
        .get() ?? null
    );
  }

  #eventsForTurn(db: DbExecutor, sessionId: string, turnId: string, type: string): AgentEventRow[] {
    return db
      .select()
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.sessionId, sessionId),
          eq(agentEvents.turnId, turnId),
          eq(agentEvents.type, type),
        ),
      )
      .orderBy(desc(agentEvents.seq))
      .all();
  }

  #resolveEvidence(
    db: DbExecutor,
    context: { sessionId: string; turnId: string },
    input: RememberToolInput,
  ): { turnId: string; eventSeq: number; quote?: string } {
    const evidence = input.evidence.kind;

    if (evidence === "user_statement") {
      const message = this.#eventsForTurn(db, context.sessionId, context.turnId, "user.message")[0];

      if (message === undefined) {
        throw new MemoryError("MEMORY_INVALID_EVIDENCE", "no user message in this Turn");
      }

      const text = parsePayload(message.payloadJson).text;
      const quote = input.evidence.quote ?? (typeof text === "string" ? text : undefined);

      if (input.scope === "global" && input.evidence.quote === undefined) {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "global preferences need an exact user quote",
        );
      }

      return {
        turnId: context.turnId,
        eventSeq: message.seq,
        ...(quote === undefined ? {} : { quote }),
      };
    }

    if (evidence === "command_succeeded") {
      const completed = this.#eventsForTurn(
        db,
        context.sessionId,
        context.turnId,
        "tool.completed",
      ).find((event) => {
        const payload = parsePayload(event.payloadJson);
        return (
          typeof payload.resultSummary === "string" && payload.resultSummary.includes("exit code 0")
        );
      });

      if (completed === undefined) {
        throw new MemoryError("MEMORY_INVALID_EVIDENCE", "no successful command in this Turn");
      }

      return { turnId: context.turnId, eventSeq: completed.seq };
    }

    if (evidence === "file_observed") {
      const read = this.#eventsForTurn(
        db,
        context.sessionId,
        context.turnId,
        "tool.completed",
      ).find((event) => parsePayload(event.payloadJson).fileRead !== undefined);

      if (read === undefined) {
        throw new MemoryError("MEMORY_INVALID_EVIDENCE", "no file read in this Turn");
      }

      return { turnId: context.turnId, eventSeq: read.seq };
    }

    if (evidence === "failure_then_success") {
      const completed = this.#eventsForTurn(
        db,
        context.sessionId,
        context.turnId,
        "tool.completed",
      )[0];
      const failed = this.#eventsForTurn(db, context.sessionId, context.turnId, "tool.failed")[0];

      if (completed === undefined || failed === undefined || failed.seq > completed.seq) {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "no failure-then-success sequence in this Turn",
        );
      }

      return { turnId: context.turnId, eventSeq: completed.seq };
    }

    const inference =
      this.#eventsForTurn(db, context.sessionId, context.turnId, "assistant.message")[0] ??
      this.#eventsForTurn(db, context.sessionId, context.turnId, "tool.completed")[0];

    if (inference === undefined) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "no assistant evidence in this Turn");
    }

    return { turnId: context.turnId, eventSeq: inference.seq };
  }

  /**
   * Model-facing entry point: evidence ids are derived from the current Turn so
   * the model cannot point at another session or forge an event sequence.
   */
  rememberFromTurn(
    input: RememberToolInput,
    context: { sessionId: string; turnId: string },
    actor: "agent" | "user" = "agent",
  ): MemoryDto {
    const evidence = this.#resolveEvidence(this.#db, context, input);

    return this.remember(
      {
        scope: input.scope,
        kind: input.kind,
        key: input.key,
        title: input.title,
        body: input.body,
        evidence: {
          kind: input.evidence.kind,
          turnId: evidence.turnId,
          eventSeq: evidence.eventSeq,
          ...(evidence.quote === undefined ? {} : { quote: evidence.quote }),
        },
        ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
      },
      actor,
    );
  }

  #previousEvents(db: DbExecutor, sessionId: string, beforeSeq: number): AgentEventRow[] {
    return db
      .select()
      .from(agentEvents)
      .where(and(eq(agentEvents.sessionId, sessionId), lt(agentEvents.seq, beforeSeq)))
      .orderBy(desc(agentEvents.seq))
      .limit(400)
      .all();
  }

  #validateEvidence(
    db: DbExecutor,
    scope: MemoryScope,
    projectId: string | null,
    input: RememberInput,
  ): MemoryContext {
    const turn = getTurnById(db, input.evidence.turnId);

    if (turn === null) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source turn not found");
    }

    const session = getSessionById(db, turn.sessionId);

    if (session === null) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source session not found");
    }

    if (scope === "project" && session.projectId !== projectId) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source turn is outside this project");
    }

    const event = this.#eventBySeq(db, session.id, input.evidence.eventSeq);

    if (event === null) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source event not found");
    }

    const payload = parsePayload(event.payloadJson);
    const evidence = input.evidence.kind;

    if (evidence === "user_statement") {
      const text = typeof payload.text === "string" ? payload.text : "";
      const quote = input.evidence.quote ?? "";
      if (event.type !== "user.message" || quote.length === 0 || !text.includes(quote)) {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "user quote does not match the source message",
        );
      }
    } else if (evidence === "command_succeeded") {
      if (event.type !== "tool.completed") {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "command evidence must be a completed tool result",
        );
      }
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : "";
      const requested = this.#previousEvents(db, session.id, event.seq).find((row) => {
        if (row.type !== "tool.requested") return false;
        const data = parsePayload(row.payloadJson);
        return data.toolCallId === toolCallId;
      });
      const name = requested === undefined ? "" : parsePayload(requested.payloadJson).name;
      const summary = typeof payload.resultSummary === "string" ? payload.resultSummary : "";
      if ((name !== "run_command" && name !== "run_shell") || !summary.includes("exit code 0")) {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "command evidence must be a successful command",
        );
      }
    } else if (evidence === "file_observed") {
      if (event.type !== "tool.completed") {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "file evidence must be a completed tool result",
        );
      }
      if (payload.fileRead === undefined) {
        throw new MemoryError("MEMORY_INVALID_EVIDENCE", "file evidence must include a file read");
      }
    } else if (evidence === "failure_then_success") {
      if (event.type !== "tool.completed") {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "gotcha evidence must end in a successful result",
        );
      }
      const failed = this.#previousEvents(db, session.id, event.seq).some(
        (row) => row.type === "tool.failed" && row.turnId === turn.id,
      );
      if (!failed) {
        throw new MemoryError("MEMORY_INVALID_EVIDENCE", "gotcha evidence needs a prior failure");
      }
    } else if (evidence === "agent_inference") {
      if (event.type !== "assistant.message" && event.type !== "tool.completed") {
        throw new MemoryError(
          "MEMORY_INVALID_EVIDENCE",
          "inference evidence must be an assistant message",
        );
      }
    }

    return { session, turn };
  }

  remember(input: RememberInput, actor: "agent" | "user" = "agent"): MemoryDto {
    const now = this.#now();
    const scope = input.scope;
    const sourceTurn = getTurnById(this.#db, input.evidence.turnId);

    if (sourceTurn === null) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source turn not found");
    }

    const sourceSession = getSessionById(this.#db, sourceTurn.sessionId);

    if (sourceSession === null) {
      throw new MemoryError("MEMORY_INVALID_EVIDENCE", "source session not found");
    }

    const projectId = scope === "project" ? sourceSession.projectId : null;

    if (scope === "project" && projectId === null) {
      throw new MemoryError(
        "MEMORY_SCOPE_FORBIDDEN",
        "project memory requires a registered project",
      );
    }

    if (scope === "global" && sourceSession.projectId !== null) {
      const sourceProject = getProjectById(this.#db, sourceSession.projectId);

      if (
        sourceProject !== null &&
        !parseProjectSettings(sourceProject.settingsJson).memory.globalEnabled
      ) {
        throw new MemoryError(
          "MEMORY_SCOPE_FORBIDDEN",
          "this project does not allow global preferences",
        );
      }
    }

    const projectRow = projectId === null ? null : this.project(projectId);
    this.#assertEnabled(projectRow);

    if (scope === "global" && input.kind !== "preference") {
      throw new MemoryError("MEMORY_SCOPE_FORBIDDEN", "global memory only supports preferences");
    }

    const content = memoryContentVerdict(scope, input.body);

    if (!content.ok) {
      throw new MemoryError("MEMORY_SECRET_REJECTED", content.reason);
    }

    const projectKey = this.#projectKey(scope, projectId);
    const confidence = input.confidence ?? (scope === "global" ? 0.9 : 0.65);
    const context = this.#validateEvidence(this.#db, scope, projectId, input);
    void context;

    const hash = bodyHash(input.body);

    if (
      suppressionByKey(this.#db, scope, projectKey, input.key) !== null ||
      suppressionByBodyHash(this.#db, scope, projectKey, hash) !== null
    ) {
      throw new MemoryError("MEMORY_SUPPRESSED", "this memory was forgotten recently");
    }

    const existing = activeMemoryByKey(this.#db, scope, projectKey, input.key);

    if (existing !== null && existing.body.trim() === input.body.trim()) {
      return this.#toDto(existing, now);
    }

    let status: MemoryStatus = "review";

    if (input.kind !== "decision" && evidenceMatchesKind(input.kind, input.evidence.kind)) {
      if (scope === "global") {
        if (
          input.evidence.kind === "user_statement" &&
          confidence >= MEMORY_AUTO_CONFIDENCE_GLOBAL
        ) {
          status = "active";
        }
      } else if (confidence >= MEMORY_AUTO_CONFIDENCE_PROJECT) {
        status = "active";
      }
    }

    if (existing !== null && status === "active" && confidence < existing.confidence) {
      status = "review";
    }

    const expiresAt =
      input.kind === "command" || input.kind === "fact" ? now + 30 * 24 * 60 * 60 * 1_000 : null;

    const row = immediateTransaction(this.#db, (tx) => {
      if (existing !== null && status === "active") {
        updateMemoryRow(tx, existing.id, { status: "superseded", updatedAt: now });
      }

      const created: MemoryRow = {
        id: newId("mem"),
        scope,
        projectId,
        projectKey,
        kind: input.kind,
        key: input.key,
        title: input.title.trim(),
        body: input.body.trim(),
        status,
        confidence,
        evidenceKind: input.evidence.kind,
        sourceTurnId: input.evidence.turnId,
        sourceEventSeq: input.evidence.eventSeq,
        createdBy: actor,
        useCount: 0,
        lastUsedAt: null,
        lastConfirmedAt: status === "active" ? now : null,
        correctionCount: 0,
        pinned: false,
        bytes: memoryBytes(input.key, input.title.trim(), input.body.trim()),
        verifiedAt: status === "active" ? now : null,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      };

      insertMemoryRow(tx, created);
      insertRevisionRow(tx, {
        id: newId("mrev"),
        memoryId: created.id,
        revision: 1,
        title: created.title,
        body: created.body,
        status: created.status,
        changedBy: actor,
        changedAt: now,
        reason: "initial",
      });
      appendAudit(tx, {
        action: status === "active" ? "memory.learned" : "memory.reviewed",
        decision: "info",
        resourceType: "memory",
        resourceId: created.id,
        details: { scope, kind: created.kind, status, bytes: created.bytes },
        now,
      });
      enforceBudget(tx, scope, projectKey, now, this.#publish);
      return memoryById(tx, created.id) ?? created;
    });

    this.#publish({
      scope,
      ...(projectId === null ? {} : { projectId }),
      memoryId: row.id,
      action:
        row.status === "active" ? "learned" : row.status === "evicted" ? "evicted" : "reviewed",
      status: row.status,
    });

    return this.#toDto(row, now);
  }

  read(
    projectId: string,
    input: { keys?: string[]; query?: string; limit?: number },
  ): MemoryReadResult {
    const project = this.project(projectId);
    this.#assertEnabled(project);
    const now = this.#now();
    expireDueMemoryRows(this.#db, now);
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? 5), 1), 5);

    let rows: MemoryRow[];

    if (input.keys !== undefined && input.keys.length > 0) {
      rows = this.#db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.scope, "project"),
            eq(memories.projectKey, projectId),
            eq(memories.status, "active"),
            inArray(memories.key, input.keys.slice(0, limit)),
          ),
        )
        .orderBy(desc(memories.updatedAt))
        .all();
    } else if (input.query !== undefined && input.query.trim().length > 0) {
      const needle = `%${input.query.trim().toLowerCase()}%`;
      const match = or(
        like(memories.key, needle),
        like(memories.title, needle),
        like(memories.body, needle),
      );
      rows = this.#db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.scope, "project"),
            eq(memories.projectKey, projectId),
            eq(memories.status, "active"),
            match,
          ),
        )
        .orderBy(desc(memories.updatedAt))
        .limit(limit)
        .all();
    } else {
      rows = activeMemoryRows(this.#db, "project", projectId).slice(0, limit);
    }

    for (const row of rows) incrementMemoryUsage(this.#db, row.id, now);
    const items = rows.map((row) => ({
      ...this.#toDto(row, now),
      body: row.body.slice(0, 1_000),
    }));

    return {
      items,
      truncated: rows.length >= limit || rows.some((row) => row.body.length > 1_000),
    };
  }

  update(
    id: string,
    patch: {
      title?: string;
      body?: string;
      expiresAt?: number | null;
      pinned?: boolean;
      status?: "active" | "rejected";
      expectedUpdatedAt: number;
    },
    actor: "agent" | "user",
  ): MemoryDto {
    const now = this.#now();
    const current = memoryById(this.#db, id);

    if (current === null) {
      throw new MemoryError("MEMORY_NOT_FOUND", "memory not found");
    }

    if (current.updatedAt !== patch.expectedUpdatedAt) {
      throw new MemoryError("VERSION_CONFLICT", "memory was changed by another client");
    }

    const project = current.scope === "project" ? this.project(current.projectId ?? "") : null;
    this.#assertEnabled(project);

    const targetStatus =
      patch.status === undefined
        ? current.status
        : current.status === "review"
          ? patch.status
          : (() => {
              throw new MemoryError("MEMORY_INVALID_STATE", "only review items can change status");
            })();

    const title = patch.title?.trim() ?? current.title;
    const body = patch.body?.trim() ?? current.body;

    if (title.length === 0 || title.length > 120 || body.length === 0 || body.length > 4_000) {
      throw new MemoryError("VALIDATION_ERROR", "memory title or body is too long");
    }

    const content = memoryContentVerdict(current.scope, body);

    if (!content.ok) throw new MemoryError("MEMORY_SECRET_REJECTED", content.reason);

    const corrected = body !== current.body || title !== current.title;
    const nextBytes = memoryBytes(current.key, title, body);

    const row = immediateTransaction(this.#db, (tx) => {
      if (targetStatus === "active" && current.status === "review") {
        const active = activeMemoryByKey(tx, current.scope, current.projectKey, current.key);
        if (active !== null && active.id !== current.id) {
          updateMemoryRow(tx, active.id, { status: "superseded", updatedAt: now });
        }
      }

      updateMemoryRow(tx, id, {
        title,
        body,
        status: targetStatus,
        expiresAt: patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt,
        pinned: patch.pinned ?? current.pinned,
        bytes: nextBytes,
        ...(corrected
          ? {
              correctionCount: current.correctionCount + 1,
              confidence: 0.8,
              verifiedAt: now,
              lastConfirmedAt: now,
            }
          : {}),
        ...(targetStatus === "active" ? { verifiedAt: now, lastConfirmedAt: now } : {}),
        updatedAt: now,
      });
      const revision = countRevisionRows(tx, id) + 1;
      insertRevisionRow(tx, {
        id: newId("mrev"),
        memoryId: id,
        revision,
        title,
        body,
        status: targetStatus,
        changedBy: actor,
        changedAt: now,
        reason: corrected ? "corrected" : "updated",
      });
      if (targetStatus === "rejected") {
        upsertSuppressionRow(tx, {
          id: newId("msup"),
          scope: current.scope,
          projectId: current.projectId,
          projectKey: current.projectKey,
          key: current.key,
          bodyHash: bodyHash(current.body),
          createdAt: now,
          expiresAt: now + MEMORY_SUPPRESSION_RETENTION_MS,
        });
      }
      appendAudit(tx, {
        action: targetStatus === "rejected" ? "memory.reviewed" : "memory.updated",
        decision: "info",
        resourceType: "memory",
        resourceId: id,
        details: { scope: current.scope, status: targetStatus, bytes: nextBytes, actor },
        now,
      });
      trimRevisions(tx, now);
      return memoryById(tx, id) as MemoryRow;
    });

    this.#publish({
      scope: row.scope,
      ...(row.projectId === null ? {} : { projectId: row.projectId }),
      memoryId: row.id,
      action: targetStatus === "rejected" ? "reviewed" : "updated",
      status: row.status,
    });

    return this.#toDto(row, now);
  }

  forget(id: string, actor: "agent" | "user"): void {
    const current = memoryById(this.#db, id);

    if (current === null) {
      throw new MemoryError("MEMORY_NOT_FOUND", "memory not found");
    }

    const now = this.#now();
    const project = current.scope === "project" ? this.project(current.projectId ?? "") : null;
    this.#assertEnabled(project);

    immediateTransaction(this.#db, (tx) => {
      upsertSuppressionRow(tx, {
        id: newId("msup"),
        scope: current.scope,
        projectId: current.projectId,
        projectKey: current.projectKey,
        key: current.key,
        bodyHash: bodyHash(current.body),
        createdAt: now,
        expiresAt: now + MEMORY_SUPPRESSION_RETENTION_MS,
      });
      deleteMemoryRow(tx, id);
      appendAudit(tx, {
        action: "memory.forgotten",
        decision: "info",
        resourceType: "memory",
        resourceId: id,
        details: { scope: current.scope, kind: current.kind, actor },
        now,
      });
    });

    this.#publish({
      scope: current.scope,
      ...(current.projectId === null ? {} : { projectId: current.projectId }),
      memoryId: id,
      action: "forgotten",
      status: "rejected",
    });
  }

  restore(id: string, actor: "agent" | "user"): MemoryDto {
    const current = memoryById(this.#db, id);

    if (current === null) {
      throw new MemoryError("MEMORY_NOT_FOUND", "memory not found");
    }

    if (current.status !== "evicted") {
      throw new MemoryError("MEMORY_INVALID_STATE", "only evicted memories can be restored");
    }

    const now = this.#now();

    if (current.updatedAt < now - MEMORY_EVICTED_RESTORE_MS) {
      throw new MemoryError("MEMORY_INVALID_STATE", "restore window has expired");
    }

    const conflict = activeMemoryByKey(this.#db, current.scope, current.projectKey, current.key);

    if (conflict !== null) {
      throw new MemoryError("CONFLICT", "an active memory with this key already exists");
    }

    const row = immediateTransaction(this.#db, (tx) => {
      updateMemoryRow(tx, id, { status: "active", updatedAt: now, verifiedAt: now });
      appendAudit(tx, {
        action: "memory.restored",
        decision: "info",
        resourceType: "memory",
        resourceId: id,
        details: { scope: current.scope, bytes: current.bytes, actor },
        now,
      });
      enforceBudget(tx, current.scope, current.projectKey, now, this.#publish);
      return memoryById(tx, id) as MemoryRow;
    });

    this.#publish({
      scope: row.scope,
      ...(row.projectId === null ? {} : { projectId: row.projectId }),
      memoryId: row.id,
      action: "restored",
      status: row.status,
    });

    return this.#toDto(row, now);
  }

  revisions(id: string) {
    const current = memoryById(this.#db, id);

    if (current === null) throw new MemoryError("MEMORY_NOT_FOUND", "memory not found");

    return listRevisionRows(this.#db, id);
  }

  activeProjectMemories(projectId: string): MemoryRow[] {
    const project = this.project(projectId);
    this.#assertEnabled(project);
    expireDueMemoryRows(this.#db, this.#now());
    return activeMemoryRows(this.#db, "project", projectId).sort((left, right) => {
      const rank = kindRank(left.kind) - kindRank(right.kind);
      return rank === 0 ? left.key.localeCompare(right.key) : rank;
    });
  }

  activeGlobalPreferences(projectId?: string): MemoryRow[] {
    if (!this.#enabled()) return [];

    if (projectId !== undefined) {
      const project = getProjectById(this.#db, projectId);

      if (project === null || !parseProjectSettings(project.settingsJson).memory.globalEnabled) {
        return [];
      }
    }

    expireDueMemoryRows(this.#db, this.#now());
    return activeMemoryRows(this.#db, "global", "").filter((row) => row.kind === "preference");
  }

  purgeRetention(): void {
    purgeMemoryRetention(this.#db, this.#now());
  }
}

function totalBytes(db: DbExecutor, scope: MemoryScope, projectKey: string): number {
  return (
    sumMemoryBytes(db, scope, projectKey) +
    sumRevisionBytes(db, scope, projectKey) +
    sumSuppressionBytes(db, scope, projectKey)
  );
}

/**
 * Enforces active and total budgets. Eviction preserves a 7-day restore window
 * unless total pressure requires dropping the oldest evicted rows first.
 */
function enforceBudget(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  now: number,
  publish: (payload: MemoryChangedPayload) => void,
): void {
  const limits = limitsFor(scope);
  const active = activeMemoryRows(db, scope, projectKey);
  let activeBytes = active.reduce((total, row) => total + row.bytes, 0);
  let activeCount = active.length;
  let total = totalBytes(db, scope, projectKey);

  if (
    activeBytes <= limits.activeBytes * 0.9 &&
    activeCount <= limits.activeCount * 0.9 &&
    total <= limits.totalBytes * 0.9
  ) {
    return;
  }

  trimRevisions(db, now);
  total = totalBytes(db, scope, projectKey);

  // Recovery copies and expired/rejected rows are cheaper to drop than active
  // knowledge, so total pressure removes them first.
  if (total > limits.totalBytes * 0.9) {
    total = dropInactive(db, scope, projectKey, limits.totalBytes * 0.8, total);
  }

  const candidates = evictionOrder(active, now);

  while (
    activeBytes > limits.activeBytes * 0.8 ||
    activeCount > limits.activeCount * 0.8 ||
    total > limits.totalBytes * 0.8
  ) {
    const victim = candidates.shift();

    if (victim === undefined) {
      throw new MemoryError("MEMORY_BUDGET_FULL", "memory budget is full of pinned entries");
    }

    if (total > limits.totalBytes * 0.8) {
      // Under total pressure there is no room for a 7-day recovery copy.
      deleteMemoryRow(db, victim.id);
      total -= victim.bytes;
    } else {
      updateMemoryRow(db, victim.id, { status: "evicted", updatedAt: now });
    }

    activeBytes -= victim.bytes;
    activeCount -= 1;
    appendAudit(db, {
      action: "memory.evicted",
      decision: "info",
      resourceType: "memory",
      resourceId: victim.id,
      details: { scope, bytes: victim.bytes },
      now,
    });
    publish({
      scope,
      ...(scope === "project" ? { projectId: projectKey } : {}),
      memoryId: victim.id,
      action: "evicted",
      status: "evicted",
    });
  }
}

function dropInactive(
  db: DbExecutor,
  scope: MemoryScope,
  projectKey: string,
  target: number,
  total: number,
): number {
  const rows = memoryRowsByStatuses(db, scope, projectKey, [
    "rejected",
    "expired",
    "evicted",
    "review",
  ]).sort((left, right) => left.updatedAt - right.updatedAt);
  let remaining = total;

  for (const row of rows) {
    if (remaining <= target) break;
    deleteMemoryRow(db, row.id);
    remaining -= row.bytes;
  }

  return remaining;
}
