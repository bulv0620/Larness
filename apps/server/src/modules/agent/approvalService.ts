import { createHash } from "node:crypto";
import type { ErrorCode } from "@larness/shared";
import { desc, eq, lt } from "drizzle-orm";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import { type ApprovalRow, type ApprovalStatus, approvals } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getTurnById } from "../sessions/repository.js";

export type ApprovalDecision = "approve" | "reject";

export const DEFAULT_APPROVAL_TTL_MS = 5 * 60_000;
const MAX_APPROVAL_TTL_MS = 60 * 60_000;
const MAX_SCOPE_BYTES = 64 * 1024;

export class ApprovalError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApprovalError";
    this.code = code;
    this.details = details;
  }
}

export interface ApprovalDto {
  id: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  risk: string;
  status: ApprovalStatus;
  scope: unknown;
  paramsHash: string;
  expiresAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  createdAt: number;
}

export interface ApprovalServiceOptions {
  db: Database;
  now?: () => number;
}

export interface RequestApprovalInput {
  turnId: string;
  toolCallId: string;
  toolName: string;
  risk: string;
  scope: unknown;
  params: unknown;
  ttlMs?: number;
  clientSessionId?: string;
}

export interface DecideApprovalInput {
  id: string;
  decision: ApprovalDecision;
  decidedBy: string;
  clientSessionId?: string;
}

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function approvalDto(row: ApprovalRow): ApprovalDto {
  return {
    id: row.id,
    turnId: row.turnId,
    toolCallId: row.toolCallId,
    toolName: row.toolName,
    risk: row.risk,
    status: row.status,
    scope: parseJson(row.scopeJson),
    paramsHash: row.paramsHash,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    createdAt: row.createdAt,
  };
}

export function canonicalizeParams(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeParams(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalizeParams(record[key]);
    }

    return sorted;
  }

  return value;
}

export function hashApprovalParams(params: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeParams(params)) ?? "null")
    .digest("hex");
}

function getApprovalRow(db: DbExecutor, id: string): ApprovalRow | null {
  return db.select().from(approvals).where(eq(approvals.id, id)).get() ?? null;
}

function expireRow(
  db: DbExecutor,
  row: ApprovalRow,
  now: number,
  clientSessionId?: string,
): ApprovalRow {
  db.update(approvals)
    .set({ status: "expired", decidedAt: now })
    .where(eq(approvals.id, row.id))
    .run();
  appendAudit(db, {
    action: "approval.expired",
    decision: "deny",
    clientSessionId,
    sessionId: getTurnById(db, row.turnId)?.sessionId,
    resourceType: "approval",
    resourceId: row.id,
    details: { turnId: row.turnId, toolName: row.toolName, risk: row.risk },
    now,
  });

  return { ...row, status: "expired", decidedAt: now };
}

export function requestApproval(
  options: ApprovalServiceOptions,
  input: RequestApprovalInput,
): ApprovalDto {
  const now = options.now?.() ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS;

  if (!Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_APPROVAL_TTL_MS) {
    throw new ApprovalError("VALIDATION_ERROR", "invalid approval ttl");
  }

  const turn = getTurnById(options.db, input.turnId);

  if (turn === null) {
    throw new ApprovalError("NOT_FOUND", "turn not found");
  }

  const scopeJson = JSON.stringify(input.scope ?? {});

  if (Buffer.byteLength(scopeJson, "utf8") > MAX_SCOPE_BYTES) {
    throw new ApprovalError("VALIDATION_ERROR", "approval scope is too large");
  }

  const row = immediateTransaction(options.db, (tx) => {
    const created: ApprovalRow = {
      id: newId("apv"),
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      risk: input.risk,
      status: "pending",
      scopeJson,
      paramsHash: hashApprovalParams(input.params),
      expiresAt: now + ttlMs,
      decidedAt: null,
      decidedBy: null,
      createdAt: now,
    };

    tx.insert(approvals).values(created).run();
    appendAudit(tx, {
      action: "approval.requested",
      decision: "info",
      clientSessionId: input.clientSessionId,
      sessionId: turn.sessionId,
      resourceType: "approval",
      resourceId: created.id,
      details: {
        turnId: created.turnId,
        toolCallId: created.toolCallId,
        toolName: created.toolName,
        risk: created.risk,
      },
      now,
    });

    return created;
  });

  return approvalDto(row);
}

export function getApproval(options: ApprovalServiceOptions, id: string): ApprovalDto {
  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    const row = getApprovalRow(tx, id);

    if (row === null) {
      throw new ApprovalError("NOT_FOUND", "approval not found");
    }

    if (row.status === "pending" && row.expiresAt <= now) {
      return approvalDto(expireRow(tx, row, now));
    }

    return approvalDto(row);
  });
}

export function decideApproval(
  options: ApprovalServiceOptions,
  input: DecideApprovalInput,
): ApprovalDto {
  const now = options.now?.() ?? Date.now();
  let expiredNow = false;

  const decided = immediateTransaction(options.db, (tx) => {
    const row = getApprovalRow(tx, input.id);

    if (row === null) {
      throw new ApprovalError("NOT_FOUND", "approval not found");
    }

    if (row.status === "pending" && row.expiresAt <= now) {
      const expired = expireRow(tx, row, now, input.clientSessionId);
      expiredNow = true;
      return approvalDto(expired);
    }

    if (row.status !== "pending") {
      throw new ApprovalError("APPROVAL_INVALID", "approval is not pending");
    }

    const status: ApprovalStatus = input.decision === "approve" ? "approved" : "denied";
    tx.update(approvals)
      .set({ status, decidedAt: now, decidedBy: input.decidedBy })
      .where(eq(approvals.id, row.id))
      .run();
    appendAudit(tx, {
      action: status === "approved" ? "approval.granted" : "approval.denied",
      decision: status === "approved" ? "allow" : "deny",
      clientSessionId: input.clientSessionId,
      sessionId: getTurnById(tx, row.turnId)?.sessionId,
      resourceType: "approval",
      resourceId: row.id,
      details: {
        turnId: row.turnId,
        toolName: row.toolName,
        risk: row.risk,
        decidedBy: input.decidedBy,
      },
      now,
    });

    return approvalDto({ ...row, status, decidedAt: now, decidedBy: input.decidedBy });
  });

  if (expiredNow) {
    throw new ApprovalError("APPROVAL_INVALID", "approval expired");
  }

  return decided;
}

export function assertApprovalMatches(
  options: ApprovalServiceOptions & { clientSessionId?: string },
  input: { id: string; params: unknown },
): ApprovalDto {
  const now = options.now?.() ?? Date.now();

  let expiredNow = false;
  let mismatch = false;

  const matched = immediateTransaction(options.db, (tx) => {
    const row = getApprovalRow(tx, input.id);

    if (row === null) {
      throw new ApprovalError("NOT_FOUND", "approval not found");
    }

    if (row.status === "pending" && row.expiresAt <= now) {
      const expired = expireRow(tx, row, now, options.clientSessionId);
      expiredNow = true;
      return approvalDto(expired);
    }

    if (row.status !== "approved") {
      throw new ApprovalError("APPROVAL_INVALID", "approval is not granted");
    }

    if (row.expiresAt <= now) {
      const expired = expireRow(tx, row, now, options.clientSessionId);
      expiredNow = true;
      return approvalDto(expired);
    }

    if (hashApprovalParams(input.params) !== row.paramsHash) {
      appendAudit(tx, {
        action: "approval.invalid",
        decision: "deny",
        clientSessionId: options.clientSessionId,
        sessionId: getTurnById(tx, row.turnId)?.sessionId,
        resourceType: "approval",
        resourceId: row.id,
        details: { turnId: row.turnId, reason: "params_mismatch" },
        now,
      });
      mismatch = true;
    }

    return approvalDto(row);
  });

  if (expiredNow) {
    throw new ApprovalError("APPROVAL_INVALID", "approval expired");
  }

  if (mismatch) {
    throw new ApprovalError("APPROVAL_INVALID", "approval parameters do not match");
  }

  return matched;
}

export function expirePendingApprovals(options: ApprovalServiceOptions): number {
  const now = options.now?.() ?? Date.now();
  const rows = options.db
    .select()
    .from(approvals)
    .where(lt(approvals.expiresAt, now))
    .orderBy(desc(approvals.createdAt))
    .all();
  let expired = 0;

  for (const row of rows) {
    if (row.status !== "pending") {
      continue;
    }

    immediateTransaction(options.db, (tx) => {
      const current = getApprovalRow(tx, row.id);

      if (current === null || current.status !== "pending" || current.expiresAt > now) {
        return;
      }

      expireRow(tx, current, now);
      expired += 1;
    });
  }

  return expired;
}

export function invalidateTurnApprovals(options: ApprovalServiceOptions, turnId: string): void {
  const now = options.now?.() ?? Date.now();
  immediateTransaction(options.db, (tx) => {
    const rows = tx.select().from(approvals).where(eq(approvals.turnId, turnId)).all();
    for (const row of rows) {
      if (row.status === "pending" || (row.toolName === "run_command" && row.status === "approved"))
        expireRow(tx, row, now);
    }
  });
}
