import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  type ResourceLockRow,
  type ResourceOperationRow,
  resourceLocks,
  turns,
} from "../../db/schema.js";
import { commandByOperation } from "../commands/repository.js";
import { quarantinedRoots } from "../locks/quarantine.js";
import { releaseResourceLock } from "../locks/service.js";
import { terminalByOperation } from "../terminals/repository.js";
import { pendingOperations, updateOperation } from "./repository.js";

const ACTIVE_TURN_STATUSES = new Set([
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "CANCELLING",
]);

export interface RecoveryLogger {
  warn(fields: Record<string, unknown>, message?: string): void;
}

export interface RecoveryOptions {
  db: Database;
  now?: () => number;
  logger?: RecoveryLogger;
}

export interface SweepSummary {
  finalizedOperations: number;
  releasedLocks: number;
  /** Pending file.save rows are left for the file reconcile policy on purpose. */
  retainedFileOperations: number;
}

// Keep whatever the row already carried (e.g. commandId) and add the sweep trail.
function reconciledResult(operation: ResourceOperationRow, reconciledBy: string): string {
  let existing: Record<string, unknown> = {};
  if (operation.resultJson !== null) {
    try {
      const parsed: unknown = JSON.parse(operation.resultJson);
      if (typeof parsed === "object" && parsed !== null)
        existing = parsed as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }
  return JSON.stringify({
    ...existing,
    reconciledBy,
    previousStatus: operation.status,
    ...(operation.errorCode === null ? {} : { previousErrorCode: operation.errorCode }),
  });
}

function finalizeOperation(
  options: RecoveryOptions,
  operation: ResourceOperationRow,
  errorCode: string,
  reconciledBy: string,
  now: number,
): void {
  updateOperation(options.db, operation.id, {
    status: "FAILED",
    errorCode,
    resultJson: reconciledResult(operation, reconciledBy),
    updatedAt: now,
  });
}

function releaseOperationLock(options: RecoveryOptions, operation: ResourceOperationRow): boolean {
  return releaseResourceLock(
    { db: options.db, now: options.now },
    { id: operation.lockId, fencingToken: operation.fencingToken },
  );
}

function lockOwnerIsActive(db: Database, lock: ResourceLockRow): boolean {
  const turn = db.select().from(turns).where(eq(turns.id, lock.executionId)).get();
  return turn !== undefined && ACTIVE_TURN_STATUSES.has(turn.status);
}

function requiresProcessReconciliation(db: Database, operation: ResourceOperationRow): boolean {
  const execution =
    operation.kind === "command.run"
      ? commandByOperation(db, operation.id)
      : operation.kind === "terminal.create"
        ? terminalByOperation(db, operation.id)
        : null;
  return (
    execution !== null &&
    (operation.status === "RECONCILIATION_REQUIRED" || execution.processIdentityJson !== null)
  );
}

// Run after resource recovery and before serving requests. The instance lock
// rules out another server, but it cannot prove an old child process stopped.
export function finalizeUnreconciledOperations(options: RecoveryOptions): SweepSummary {
  const now = options.now?.() ?? Date.now();
  const pending = pendingOperations(options.db);
  const retained = pending.filter(
    (operation) =>
      operation.kind === "file.save" || requiresProcessReconciliation(options.db, operation),
  );
  const retainedIds = new Set(retained.map((operation) => operation.id));
  const retainedLockIds = new Set(retained.map((operation) => operation.lockId));
  let finalizedOperations = 0;
  let releasedLocks = 0;

  for (const operation of pending) {
    if (retainedIds.has(operation.id)) continue;
    finalizeOperation(options, operation, "OUTCOME_UNKNOWN", "startup-sweep", now);
    if (!retainedLockIds.has(operation.lockId) && releaseOperationLock(options, operation))
      releasedLocks += 1;
    options.logger?.warn(
      {
        operationId: operation.id,
        kind: operation.kind,
        previousStatus: operation.status,
        previousErrorCode: operation.errorCode,
        path: operation.path,
        rootRealPath: operation.rootRealPath,
      },
      "startup sweep finalized operation with unknown outcome",
    );
    finalizedOperations += 1;
  }

  // Only release orphan locks that have no retained operation or active turn.
  for (const lock of options.db.select().from(resourceLocks).all()) {
    if (lock.expiresAt <= 0 || retainedLockIds.has(lock.id)) continue;
    if (lockOwnerIsActive(options.db, lock)) {
      options.logger?.warn(
        { lockId: lock.id, executionId: lock.executionId },
        "startup sweep skipped lock with an active owner turn",
      );
      continue;
    }
    if (
      releaseResourceLock(
        { db: options.db, now: options.now },
        { id: lock.id, fencingToken: lock.fencingToken },
      )
    ) {
      releasedLocks += 1;
      options.logger?.warn(
        { lockId: lock.id, resourceId: lock.resourceId, executionId: lock.executionId },
        "startup sweep released orphan lock",
      );
    }
  }

  return {
    finalizedOperations,
    releasedLocks,
    retainedFileOperations: retained.filter((operation) => operation.kind === "file.save").length,
  };
}

// Leave file recovery and unconfirmed process outcomes for startup recovery.
export function markOperationsInterrupted(options: RecoveryOptions): number {
  const now = options.now?.() ?? Date.now();
  let interrupted = 0;
  for (const operation of pendingOperations(options.db)) {
    if (operation.kind === "file.save" || requiresProcessReconciliation(options.db, operation))
      continue;
    finalizeOperation(options, operation, "INTERRUPTED", "shutdown", now);
    releaseOperationLock(options, operation);
    interrupted += 1;
  }
  return interrupted;
}

export interface ResourceOperationDiagnostics {
  id: string;
  kind: string;
  status: string;
  errorCode: string | null;
  path: string;
  rootRealPath: string;
  scopeKey: string;
  lockId: string;
  fencingToken: number;
  updatedAt: number;
  ageMs: number;
}

export interface ResourceLockDiagnostics {
  id: string;
  resourceType: string;
  resourceId: string;
  owner: string;
  executionId: string;
  fencingToken: number;
  rootRealPath: string | null;
  expiresAt: number;
  active: boolean;
  ownerTurnActive: boolean;
}

export interface ResourceDiagnostics {
  generatedAt: number;
  pendingOperations: ResourceOperationDiagnostics[];
  locks: ResourceLockDiagnostics[];
  quarantinedRoots: string[];
}

// Read-only view of everything that can block writes on a project root. This
// is the "why is my project locked" answer that used to take days to find.
export function collectResourceDiagnostics(db: Database, now = Date.now()): ResourceDiagnostics {
  const operations = pendingOperations(db).map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    status: operation.status,
    errorCode: operation.errorCode,
    path: operation.path,
    rootRealPath: operation.rootRealPath,
    scopeKey: operation.scopeKey,
    lockId: operation.lockId,
    fencingToken: operation.fencingToken,
    updatedAt: operation.updatedAt,
    ageMs: Math.max(0, now - operation.updatedAt),
  }));
  const locks = db
    .select()
    .from(resourceLocks)
    .all()
    .map((lock) => ({
      id: lock.id,
      resourceType: lock.resourceType,
      resourceId: lock.resourceId,
      owner: lock.owner,
      executionId: lock.executionId,
      fencingToken: lock.fencingToken,
      rootRealPath: lock.rootRealPath,
      expiresAt: lock.expiresAt,
      active: lock.expiresAt > now,
      ownerTurnActive: lockOwnerIsActive(db, lock),
    }));
  return {
    generatedAt: now,
    pendingOperations: operations,
    locks,
    quarantinedRoots: quarantinedRoots(),
  };
}
