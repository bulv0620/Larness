import type { Database } from "../../db/client.js";
import type { ResourceLockType } from "../../db/schema.js";
import type { ResourceLockHandle } from "./service.js";
import {
  acquireResourceLock,
  getActiveResourceLock,
  releaseResourceLock,
  renewResourceLock,
} from "./service.js";

export type LeaseKind = Extract<ResourceLockType, "project" | "service">;

export interface LeaseManagerOptions {
  db: Database;
  now?: () => number;
}

export interface AcquireProjectLeaseInput {
  projectId: string;
  owner: string;
  executionId: string;
  ttlMs: number;
  rootRealPath?: string;
}

export interface AcquireServiceLeaseInput {
  serviceId: string;
  owner: string;
  executionId: string;
  ttlMs: number;
}

/**
 * The single business-lock entry point. Files, Git, commands, service
 * operations and deployments all go through this class; only the lock
 * repository below it touches `resource_locks`.
 */
export class LeaseManager {
  readonly #options: LeaseManagerOptions;

  constructor(options: LeaseManagerOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  acquireProject(input: AcquireProjectLeaseInput): ResourceLockHandle | null {
    return acquireResourceLock(this.#options, {
      resourceType: "project",
      resourceId: input.projectId,
      owner: input.owner,
      executionId: input.executionId,
      ttlMs: input.ttlMs,
      ...(input.rootRealPath === undefined ? {} : { rootRealPath: input.rootRealPath }),
    });
  }

  acquireService(input: AcquireServiceLeaseInput): ResourceLockHandle | null {
    return acquireResourceLock(this.#options, {
      resourceType: "service",
      resourceId: input.serviceId,
      owner: input.owner,
      executionId: input.executionId,
      ttlMs: input.ttlMs,
    });
  }

  renew(handle: ResourceLockHandle, ttlMs?: number): ResourceLockHandle | null {
    return renewResourceLock(this.#options, {
      id: handle.id,
      fencingToken: handle.fencingToken,
      ttlMs: ttlMs ?? Math.max(1, handle.expiresAt - this.#now()),
    });
  }

  release(handle: ResourceLockHandle): boolean {
    return releaseResourceLock(this.#options, {
      id: handle.id,
      fencingToken: handle.fencingToken,
    });
  }

  releaseById(id: string, fencingToken: number): boolean {
    return releaseResourceLock(this.#options, { id, fencingToken });
  }

  get(kind: LeaseKind, id: string): ResourceLockHandle | null {
    return getActiveResourceLock(this.#options.db, kind, id, this.#now());
  }

  find(kind: LeaseKind, id: string): ResourceLockHandle | null {
    return getActiveResourceLock(this.#options.db, kind, id, 0);
  }
}
