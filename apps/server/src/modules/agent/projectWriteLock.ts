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
  #lost = false;
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

  /** True once a lock we held was lost to another writer or a release. */
  get lost(): boolean {
    return this.#lost;
  }

  acquire(): ResourceLockHandle | null {
    if (this.#lost) {
      return null;
    }

    if (this.#handle !== null) {
      if (this.#isCurrent(this.#handle)) {
        return this.#handle;
      }

      // The lease may have expired while this writer still owned it (for
      // example a stalled event loop). Revival only succeeds while the row
      // still carries our fencing token; a takeover clears that.
      const renewed = this.#renewHandle();
      if (renewed !== null) {
        return renewed;
      }

      this.#markLost();
      return null;
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

    const renewed = this.#renewHandle();
    if (renewed === null) {
      this.#markLost();
    }
    return renewed;
  }

  /**
   * Renew only an already-held lease. A writer that never got the lock (for
   * example because another Turn holds it) has nothing to lose yet.
   */
  renewIfHeld(): boolean {
    if (this.#lost) {
      return false;
    }
    if (this.#handle === null) {
      return true;
    }
    return this.renew() !== null;
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

  #renewHandle(): ResourceLockHandle | null {
    if (this.#handle === null) {
      return null;
    }

    const renewed = renewResourceLock(
      { db: this.#db, now: this.#now },
      {
        id: this.#handle.id,
        fencingToken: this.#handle.fencingToken,
        ttlMs: this.#ttlMs,
      },
    );

    if (renewed !== null) {
      this.#handle = renewed;
    }

    return renewed;
  }

  #markLost(): void {
    this.#lost = true;
    this.#handle = null;
  }
}
