import type { Database } from "../../db/client.js";
import {
  acquireResourceLock,
  getActiveResourceLock,
  type ResourceLockHandle,
  releaseResourceLock,
  renewResourceLock,
} from "../locks/service.js";

export class ProjectLockError extends Error {
  readonly code = "RESOURCE_LOCKED";

  constructor(message = "project write lock is not held") {
    super(message);
    this.name = "ProjectLockError";
  }
}

export interface ProjectWriteLockOptions {
  db: Database;
  projectId: string;
  owner: string;
  executionId: string;
  ttlMs?: number;
  now?: () => number;
  rootRealPath?: string;
}

const DEFAULT_TTL_MS = 30_000;

export class ProjectWriteLock {
  readonly #db: Database;
  readonly #projectId: string;
  readonly #owner: string;
  readonly #executionId: string;
  readonly #ttlMs: number;
  readonly #now: (() => number) | undefined;
  #handle: ResourceLockHandle | null = null;
  readonly #rootRealPath: string | undefined;

  constructor(options: ProjectWriteLockOptions) {
    this.#db = options.db;
    this.#projectId = options.projectId;
    this.#owner = options.owner;
    this.#executionId = options.executionId;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#now = options.now;
    this.#rootRealPath = options.rootRealPath;
  }

  get handle(): ResourceLockHandle | null {
    return this.#handle;
  }

  acquire(): ResourceLockHandle | null {
    if (this.#handle !== null && this.#isCurrent(this.#handle)) {
      return this.#handle;
    }

    this.#handle = acquireResourceLock(
      { db: this.#db, now: this.#now },
      {
        resourceType: "project",
        resourceId: this.#projectId,
        owner: this.#owner,
        executionId: this.#executionId,
        ttlMs: this.#ttlMs,
        rootRealPath: this.#rootRealPath,
      },
    );

    return this.#handle;
  }

  renew(): ResourceLockHandle | null {
    if (this.#handle === null) {
      return null;
    }

    this.#handle = renewResourceLock(
      { db: this.#db, now: this.#now },
      {
        id: this.#handle.id,
        fencingToken: this.#handle.fencingToken,
        ttlMs: this.#ttlMs,
      },
    );

    return this.#handle;
  }

  release(): boolean {
    if (this.#handle === null) {
      return false;
    }

    const released = releaseResourceLock(
      { db: this.#db, now: this.#now },
      { id: this.#handle.id, fencingToken: this.#handle.fencingToken },
    );

    if (released) {
      this.#handle = null;
    }

    return released;
  }

  current(): ResourceLockHandle | null {
    const now = this.#now?.() ?? Date.now();
    return getActiveResourceLock(this.#db, "project", this.#projectId, now);
  }

  assertHeld(): ResourceLockHandle {
    const current = this.current();

    if (
      current === null ||
      this.#handle === null ||
      current.id !== this.#handle.id ||
      current.fencingToken !== this.#handle.fencingToken
    ) {
      throw new ProjectLockError();
    }

    return current;
  }

  #isCurrent(handle: ResourceLockHandle): boolean {
    const current = this.current();
    return current?.id === handle.id && current.fencingToken === handle.fencingToken;
  }
}
