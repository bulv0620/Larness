import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import type { ResourceLockRow, ResourceLockType } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getProjectById } from "../projects/repository.js";
import {
  getResourceLockRow,
  getResourceLockRowById,
  insertResourceLockRow,
  releaseResourceLockRow,
  renewResourceLockRow,
  rootHasWriter,
  updateResourceLockRow,
} from "./repository.js";

export type ResourceLockHandle = ResourceLockRow;

export interface LockServiceOptions {
  db: Database;
  now?: () => number;
}

export interface AcquireResourceLockInput {
  resourceType: ResourceLockType;
  resourceId: string;
  owner: string;
  executionId: string;
  ttlMs: number;
  rootRealPath?: string;
}

function assertLockInput(input: {
  resourceId: string;
  owner: string;
  executionId: string;
  ttlMs: number;
}): void {
  if (input.resourceId.trim().length === 0) {
    throw new Error("resourceId must not be empty");
  }

  if (input.owner.trim().length === 0) {
    throw new Error("owner must not be empty");
  }

  if (input.executionId.trim().length === 0) {
    throw new Error("executionId must not be empty");
  }

  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("ttlMs must be a positive integer");
  }
}

export function acquireResourceLock(
  options: LockServiceOptions,
  input: AcquireResourceLockInput,
): ResourceLockHandle | null {
  assertLockInput(input);
  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    const rootRealPath =
      input.rootRealPath ??
      (input.resourceType === "project" ? getProjectById(tx, input.resourceId)?.realPath : null) ??
      null;
    if (rootRealPath !== null && rootHasWriter(tx, rootRealPath, now)) return null;
    const existing = getResourceLockRow(tx, input.resourceType, input.resourceId);

    if (existing !== null && existing.expiresAt > now) {
      return null;
    }

    const fencingToken = (existing?.fencingToken ?? 0) + 1;
    const fields = {
      owner: input.owner,
      executionId: input.executionId,
      fencingToken,
      expiresAt: now + input.ttlMs,
      heartbeatAt: now,
      rootRealPath,
    };

    if (existing !== null) {
      return updateResourceLockRow(tx, existing.id, fields);
    }

    return insertResourceLockRow(tx, {
      id: newId("lck"),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      createdAt: now,
      ...fields,
    });
  });
}

export function renewResourceLock(
  options: LockServiceOptions,
  input: { id: string; fencingToken: number; ttlMs: number },
): ResourceLockHandle | null {
  if (!Number.isInteger(input.ttlMs) || input.ttlMs <= 0) {
    throw new Error("ttlMs must be a positive integer");
  }

  const now = options.now?.() ?? Date.now();

  return immediateTransaction(options.db, (tx) => {
    const current = getResourceLockRowById(tx, input.id);

    if (current === null || current.fencingToken !== input.fencingToken || current.expiresAt <= 0) {
      return null;
    }

    // Reviving an expired lease is only safe while no other writer has taken
    // an overlapping root. Active leases cannot coexist with another writer.
    if (
      current.expiresAt <= now &&
      current.rootRealPath !== null &&
      rootHasWriter(tx, current.rootRealPath, now, current.id)
    ) {
      return null;
    }

    return renewResourceLockRow(tx, {
      id: input.id,
      fencingToken: input.fencingToken,
      expiresAt: now + input.ttlMs,
      heartbeatAt: now,
    });
  });
}

export function releaseResourceLock(
  options: LockServiceOptions,
  input: { id: string; fencingToken: number },
): boolean {
  const now = options.now?.() ?? Date.now();
  return immediateTransaction(options.db, (tx) => releaseResourceLockRow(tx, { ...input, now }));
}

export function findResourceLock(
  db: Database,
  resourceType: ResourceLockType,
  resourceId: string,
): ResourceLockHandle | null {
  return getResourceLockRow(db, resourceType, resourceId);
}

export function getActiveResourceLock(
  db: Database,
  resourceType: ResourceLockType,
  resourceId: string,
  now = Date.now(),
): ResourceLockHandle | null {
  const lock = getResourceLockRow(db, resourceType, resourceId);
  return lock !== null && lock.expiresAt > now ? lock : null;
}
