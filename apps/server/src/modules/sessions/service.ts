import { DEFAULT_PROJECT_ID } from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { SessionRow, SessionStatus } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getProjectById } from "../projects/repository.js";
import { parseProjectSettings } from "../projects/service.js";
import { ensureDefaultWorkspace, isDefaultWorkspace } from "../workspaces/default.js";
import { SessionError } from "./errors.js";
import {
  createSessionRow,
  findActiveTurnForSession,
  getSessionById,
  listSessionRows,
  touchSessionRow,
  updateSessionRow,
} from "./repository.js";
import { activeTurnForSession, type TurnDto } from "./turns.js";

const MAX_TITLE_LENGTH = 128;
const MAX_MODEL_PROFILE_ID_LENGTH = 128;

export interface SessionDto {
  id: string;
  projectId: string | null;
  workspacePath: string;
  workspaceKind: "project" | "default" | "session";
  title: string;
  status: SessionStatus;
  modelProfileId: string | null;
  approvalPolicyId: string;
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface SessionDetailDto extends SessionDto {
  activeTurn: TurnDto | null;
}

export interface SessionServiceOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
}

export interface CreateSessionInput {
  projectId?: string;
  title?: string;
  clientSessionId?: string;
}

export interface UpdateSessionInput {
  id: string;
  title?: string;
  modelProfileId?: string | null;
  approvalPolicyId?: ApprovalPolicy;
  clientSessionId?: string;
}

export type ApprovalPolicy = "standard" | "strict" | "readonly";

export function sessionDto(row: SessionRow, dataDir: string): SessionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    workspacePath: row.workspacePath,
    workspaceKind: row.projectId
      ? "project"
      : isDefaultWorkspace(dataDir, row.workspacePath)
        ? "default"
        : "session",
    title: row.title,
    status: row.status,
    modelProfileId: row.modelProfileId,
    approvalPolicyId: row.approvalPolicyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
  };
}

function normalizeTitle(title: string | undefined): string {
  const value = title?.trim();

  if (value === undefined || value.length === 0) {
    return "New session";
  }

  if (value.length > MAX_TITLE_LENGTH) {
    throw new SessionError(
      "VALIDATION_ERROR",
      `session title must be at most ${MAX_TITLE_LENGTH} characters`,
    );
  }

  return value;
}

function normalizeModelProfileId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_MODEL_PROFILE_ID_LENGTH) {
    throw new SessionError(
      "VALIDATION_ERROR",
      `modelProfileId must be 1-${MAX_MODEL_PROFILE_ID_LENGTH} characters`,
    );
  }

  return trimmed;
}

function normalizeApprovalPolicy(value: ApprovalPolicy | undefined): ApprovalPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "standard" && value !== "strict" && value !== "readonly") {
    throw new SessionError("VALIDATION_ERROR", "invalid approval policy");
  }

  return value;
}

export function listSessionDtos(
  options: SessionServiceOptions,
  query: { projectId?: string; limit?: number } = {},
): SessionDto[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 100);
  return listSessionRows(options.db, { projectId: query.projectId, limit }).map((row) =>
    sessionDto(row, options.dataDir),
  );
}

export function getSessionDetail(options: SessionServiceOptions, id: string): SessionDetailDto {
  const row = getSessionById(options.db, id);

  if (row === null) {
    throw new SessionError("NOT_FOUND", "session not found");
  }

  return {
    ...sessionDto(row, options.dataDir),
    activeTurn: activeTurnForSession(options.db, id),
  };
}

function insertSession(
  options: SessionServiceOptions,
  input: {
    id: string;
    projectId: string | null;
    workspacePath: string;
    title: string;
    modelProfileId: string | null;
    now: number;
    clientSessionId?: string;
  },
): SessionRow {
  return immediateTransaction(options.db, (tx) => {
    const created = createSessionRow(tx, {
      id: input.id,
      projectId: input.projectId,
      workspacePath: input.workspacePath,
      title: input.title,
      modelProfileId: input.modelProfileId,
      approvalPolicyId: "standard",
      now: input.now,
    });
    appendAudit(tx, {
      action: "session.created",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      sessionId: created.id,
      resourceType: "session",
      resourceId: created.id,
      details: { title: created.title, projectId: input.projectId },
      now: input.now,
    });
    return created;
  });
}

export async function createSession(
  options: SessionServiceOptions,
  input: CreateSessionInput,
): Promise<SessionDto> {
  const title = normalizeTitle(input.title);
  const now = options.now?.() ?? Date.now();
  let projectId: string | null = null;
  let modelProfileId: string | null = null;
  let workspacePath: string;

  if (input.projectId !== undefined && input.projectId !== DEFAULT_PROJECT_ID) {
    const project = getProjectById(options.db, input.projectId);

    if (project === null) {
      throw new SessionError("NOT_FOUND", "project not found");
    }

    projectId = project.id;
    workspacePath = project.realPath;
    modelProfileId = parseProjectSettings(project.settingsJson).defaultModelProfileId;
  } else {
    try {
      workspacePath = await ensureDefaultWorkspace(options.dataDir);
    } catch {
      throw new SessionError("RESOURCE_UNAVAILABLE", "Default workspace unavailable");
    }
  }

  const row = insertSession(options, {
    id: newId("ses"),
    projectId,
    workspacePath,
    title,
    modelProfileId,
    now,
    clientSessionId: input.clientSessionId,
  });

  return sessionDto(row, options.dataDir);
}

export function updateSession(
  options: SessionServiceOptions,
  input: UpdateSessionInput,
): SessionDto {
  const title = input.title === undefined ? undefined : normalizeTitle(input.title);
  const modelProfileId = normalizeModelProfileId(input.modelProfileId);
  const approvalPolicyId = normalizeApprovalPolicy(input.approvalPolicyId);
  const now = options.now?.() ?? Date.now();

  const row = immediateTransaction(options.db, (tx) => {
    const current = getSessionById(tx, input.id);

    if (current === null) {
      throw new SessionError("NOT_FOUND", "session not found");
    }

    const updated = updateSessionRow(tx, input.id, {
      title,
      modelProfileId,
      approvalPolicyId,
      updatedAt: now,
    });

    if (updated === null) {
      throw new SessionError("NOT_FOUND", "session not found");
    }

    if (modelProfileId !== undefined && modelProfileId !== current.modelProfileId) {
      appendAudit(tx, {
        action: "model.changed",
        decision: "allow",
        clientSessionId: input.clientSessionId,
        sessionId: updated.id,
        resourceType: "session",
        resourceId: updated.id,
        details: { from: current.modelProfileId, to: modelProfileId },
        now,
      });
    }

    return updated;
  });

  return sessionDto(row, options.dataDir);
}

export function archiveSession(
  options: SessionServiceOptions,
  input: { id: string; clientSessionId?: string },
): void {
  const now = options.now?.() ?? Date.now();

  immediateTransaction(options.db, (tx) => {
    const current = getSessionById(tx, input.id);

    if (current === null) {
      throw new SessionError("NOT_FOUND", "session not found");
    }

    if (current.status === "archived") {
      return;
    }

    const active = findActiveTurnForSession(tx, input.id);

    if (active !== null) {
      throw new SessionError("TURN_IN_PROGRESS", "session has an active turn", {
        turnId: active.id,
      });
    }

    updateSessionRow(tx, input.id, { status: "archived", updatedAt: now });
    touchSessionRow(tx, input.id, now);
    appendAudit(tx, {
      action: "session.deleted",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      sessionId: current.id,
      resourceType: "session",
      resourceId: current.id,
      details: { archived: true, title: current.title },
      now,
    });
  });
}
