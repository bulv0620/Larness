import type { Database } from "../../db/client.js";
import { LeaseManager } from "../locks/lease.js";
import type { ResourceLockHandle } from "../locks/service.js";

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
  readonly #projectId: string;
  readonly #owner: string;
  readonly #executionId: string;
  readonly #ttlMs: number;
  #handle: ResourceLockHandle | null = null;
  #lost = false;
  readonly #rootRealPath: string | undefined;
  readonly #leases: LeaseManager;

  constructor(options: ProjectWriteLockOptions) {
    this.#projectId = options.projectId;
    this.#owner = options.owner;
    this.#executionId = options.executionId;
    this.#ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.#rootRealPath = options.rootRealPath;
    this.#leases = new LeaseManager({
      db: options.db,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
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

    this.#handle = this.#leases.acquireProject({
      projectId: this.#projectId,
      owner: this.#owner,
      executionId: this.#executionId,
      ttlMs: this.#ttlMs,
      ...(this.#rootRealPath === undefined ? {} : { rootRealPath: this.#rootRealPath }),
    });

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

    const released = this.#leases.release(this.#handle);

    if (released) {
      this.#handle = null;
    }

    return released;
  }

  current(): ResourceLockHandle | null {
    return this.#leases.get("project", this.#projectId);
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

    const renewed = this.#leases.renew(this.#handle, this.#ttlMs);

    if (renewed !== null) {
      this.#handle = renewed;
    }

    return renewed;
  }

  #markLost(): void {
    if (this.#handle !== null) {
      try {
        // Clear our own row so a released lease cannot keep blocking the root
        // while this Turn retries. A takeover keeps its higher fencing token.
        this.#leases.releaseById(this.#handle.id, this.#handle.fencingToken);
      } catch {
        /* Best effort; the row still expires and the Turn can continue read-only. */
      }
    }

    this.#lost = true;
    this.#handle = null;
  }
}
