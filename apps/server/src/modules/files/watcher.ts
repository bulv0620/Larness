import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  createDirectoryWatcher,
  FileManagerError,
  isInsideRoot,
  normalizeFilePath,
  readEditableFile,
  resolveFilePath,
  scanWatchPath,
  type WatchedNode,
  type WatchSnapshot,
} from "@larness/resources";
import type { FileResyncReason } from "@larness/shared";
import type { Database } from "../../db/client.js";
import { immediateTransaction } from "../../db/transaction.js";
import { fileStreamScope, type ResourceEventBus } from "../resources/events.js";
import {
  appendResourceEvent,
  cacheFileVersion,
  deleteCachedFile,
  getCachedFile,
  resourceSequence,
} from "../resources/repository.js";
import {
  assertFileScopeMetadata,
  authorizeFileTarget,
  type ResolvedFileScope,
  resolveFileScope,
} from "./scope.js";

interface Interest {
  key: string;
  stream: string;
  relative: string;
  directory: boolean;
  scope: ResolvedFileScope;
  owners: Set<string>;
  snapshot: WatchSnapshot;
  reason?: FileResyncReason;
  handleKey: string;
  pendingResync?: boolean;
}
type WatchHandle = ReturnType<typeof createDirectoryWatcher>;
export interface FileWatchOptions {
  db: Database;
  dataDir: string;
  events: ResourceEventBus;
  maxWatchers?: number;
  scanLimit?: number;
  queueLimit?: number;
  intervalMs?: number;
  debounceMs?: number;
  createWatcher?: typeof createDirectoryWatcher;
  checkMetadata?: (path: string) => void;
}
export class FileWatchManager {
  readonly #interests = new Map<string, Interest>();
  readonly #handles = new Map<string, { watcher: WatchHandle; interests: Set<string> }>();
  readonly #pending = new Set<string>();
  readonly #timer: ReturnType<typeof setInterval>;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | null = null;
  #closed = false;
  #queuedEvents = 0;
  #cursor: Iterator<string> | undefined;
  constructor(readonly options: FileWatchOptions) {
    this.#timer = setInterval(() => {
      this.#cursor ??= this.#interests.keys();
      while (this.#pending.size < (this.options.queueLimit ?? 256)) {
        const entry = this.#cursor.next();
        if (entry.done) {
          this.#cursor = undefined;
          break;
        }
        this.#pending.add(entry.value);
      }
      this.#schedule();
    }, options.intervalMs ?? 2000);
    this.#timer.unref();
  }
  get watcherCount() {
    return this.#handles.size;
  }
  async subscribe(owner: string, stream: string, paths: string[]) {
    const scope = await resolveFileScope(
      this.options.db,
      this.options.dataDir,
      fileStreamScope(stream),
    );
    const requested: {
      key: string;
      relative: string;
      directory: boolean;
      snapshot: WatchSnapshot;
      handleKey: string;
    }[] = [];
    for (const relative of new Set(paths.map(normalizeFilePath))) {
      await authorizeFileTarget(scope, relative);
      const target = await resolveFilePath(scope.root, relative);
      const directory = (await lstat(target)).isDirectory();
      const key = JSON.stringify([stream, relative]);
      const snapshot = await this.#scan(scope, relative, directory);
      requested.push({
        key,
        relative,
        directory,
        snapshot,
        handleKey: directory ? target : path.dirname(target),
      });
    }
    if (this.#closed)
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "File watcher is stopping");
    assertFileScopeMetadata(this.options.db, scope);
    // Validation/scanning finishes before changing the old subscription set.
    this.unsubscribe(owner, stream);
    for (const target of requested) {
      let interest = this.#interests.get(target.key);
      if (!interest) {
        interest = { ...target, stream, scope, owners: new Set() };
        this.#interests.set(target.key, interest);
      }
      interest.owners.add(owner);
      this.#attach(interest);
      if (!this.#handles.has(interest.handleKey))
        interest.snapshot = { nodes: new Map(), identity: "unmonitored", partial: false };
      if (interest.snapshot.partial) this.#resync(interest, "SCAN_LIMIT");
    }
    if (requested.some((entry) => this.#interests.get(entry.key)?.pendingResync)) {
      this.unsubscribe(owner, stream);
      throw new FileManagerError("INTERNAL", "File monitoring state could not be persisted");
    }
    return {
      currentSequence: resourceSequence(this.options.db, stream),
      resyncRequired: true, // Every (re)subscription establishes a fresh snapshot baseline.
      partial: requested.some((entry) => this.#interests.get(entry.key)?.reason !== undefined),
    };
  }
  #queue(key: string) {
    if (this.#pending.has(key)) return;
    if (this.#pending.size >= (this.options.queueLimit ?? 256)) {
      const interest = this.#interests.get(key);
      if (interest) this.#resync(interest, "QUEUE_OVERFLOW");
      return;
    }
    this.#pending.add(key);
  }
  unsubscribe(owner: string, stream?: string) {
    for (const [key, interest] of this.#interests) {
      if (stream && interest.stream !== stream) continue;
      interest.owners.delete(owner);
      if (interest.owners.size) continue;
      this.#interests.delete(key);
      this.#pending.delete(key);
      const handle = this.#handles.get(interest.handleKey);
      handle?.interests.delete(key);
      if (handle && !handle.interests.size) {
        handle.watcher.close();
        this.#handles.delete(interest.handleKey);
      }
    }
  }
  #scan(scope: ResolvedFileScope, relative: string, directory: boolean) {
    return scanWatchPath(scope.root, relative, {
      directory,
      limit: this.options.scanLimit ?? 2000,
      ignore: scope.ignore,
      exclude:
        "projectId" in scope.scope
          ? (target) => isInsideRoot(scope.protectedRoot, target)
          : undefined,
    });
  }
  #attach(interest: Interest) {
    const existing = this.#handles.get(interest.handleKey);
    if (existing) {
      existing.interests.add(interest.key);
      return;
    }
    if (this.#handles.size >= (this.options.maxWatchers ?? 128)) {
      this.#resync(interest, "WATCH_LIMIT");
      return;
    }
    try {
      const watcher = (this.options.createWatcher ?? createDirectoryWatcher)(
        interest.handleKey,
        () => this.#notify(interest.handleKey),
        () => {
          const handle = this.#handles.get(interest.handleKey);
          handle?.watcher.close();
          this.#handles.delete(interest.handleKey);
          for (const key of handle?.interests ?? []) {
            const item = this.#interests.get(key);
            if (item) this.#resync(item, "WATCH_UNAVAILABLE");
            this.#queue(key);
          }
          this.#schedule();
        },
      );
      this.#handles.set(interest.handleKey, { watcher, interests: new Set([interest.key]) });
    } catch {
      this.#resync(interest, "WATCH_UNAVAILABLE");
    }
  }
  #notify(handleKey: string) {
    if (this.#closed) return;
    const keys = this.#handles.get(handleKey)?.interests ?? [];
    const overflow = ++this.#queuedEvents > (this.options.queueLimit ?? 256);
    for (const key of keys) {
      this.#queue(key);
      if (overflow) {
        const interest = this.#interests.get(key);
        if (interest) this.#resync(interest, "QUEUE_OVERFLOW");
      }
    }
    this.#schedule();
  }
  #schedule() {
    if (this.#closed || this.#debounce || this.#running) return;
    this.#debounce = setTimeout(() => {
      this.#debounce = undefined;
      this.#running = this.#drain().finally(() => {
        this.#running = null;
        if (this.#pending.size) this.#schedule();
      });
    }, this.options.debounceMs ?? 50);
    this.#debounce.unref();
  }
  async #drain() {
    const keys = [...this.#pending];
    this.#pending.clear();
    this.#queuedEvents = 0;
    for (const key of keys) {
      const interest = this.#interests.get(key);
      if (!interest || this.#closed) continue;
      try {
        await this.#refresh(interest);
      } catch {
        if (!this.#closed) this.#resync(interest, "SCAN_FAILED");
      }
    }
  }
  #resync(interest: Interest, reason: FileResyncReason, retry = false) {
    if (
      (interest.reason === reason && !retry) ||
      this.#closed ||
      this.#interests.get(interest.key) !== interest
    )
      return;
    interest.reason = reason;
    interest.pendingResync = true;
    try {
      const event = immediateTransaction(this.options.db, (tx) =>
        appendResourceEvent(
          tx,
          interest.stream,
          "file.resync.required",
          { reasonCode: reason },
          Date.now(),
        ),
      );
      interest.pendingResync = false;
      this.options.events.publish(event);
    } catch {
      /* Keep invalidation pending until it can be durably published. */
    }
  }
  async #refresh(interest: Interest) {
    if (interest.pendingResync && interest.reason) {
      this.#resync(interest, interest.reason, true);
      if (interest.pendingResync) return;
    }
    if (
      !this.#handles.has(interest.handleKey) &&
      this.#handles.size >= (this.options.maxWatchers ?? 128)
    ) {
      this.#resync(interest, "WATCH_LIMIT");
      return;
    }
    let scope: ResolvedFileScope;
    try {
      scope = await resolveFileScope(this.options.db, this.options.dataDir, interest.scope.scope);
    } catch {
      this.#resync(interest, "ROOT_UNAVAILABLE");
      return;
    }
    const next = await this.#scan(scope, interest.relative, interest.directory);
    if (this.#closed || this.#interests.get(interest.key) !== interest) return;
    assertFileScopeMetadata(this.options.db, scope);
    if (scope.root !== interest.scope.root) {
      this.#resync(interest, "ROOT_UNAVAILABLE");
      return;
    }
    if (next.partial) {
      this.#resync(interest, "SCAN_LIMIT");
      return;
    }
    const replaced = interest.snapshot.identity !== next.identity && interest.directory;
    if (replaced) {
      const handle = this.#handles.get(interest.handleKey);
      handle?.watcher.close();
      this.#handles.delete(interest.handleKey);
      if (handle) for (const key of handle.interests) this.#queue(key);
      this.#resync(interest, "DIRECTORY_REPLACED");
    }
    const lost = interest.reason !== undefined;
    this.#attach(interest);
    if (interest.snapshot.partial || interest.snapshot.identity === "unmonitored") {
      if (this.#handles.has(interest.handleKey)) {
        this.#resync(interest, "RECOVERED");
        if (!interest.pendingResync) interest.reason = undefined;
      }
      interest.snapshot = next;
      return;
    }
    for (const [relative, node] of next.nodes) {
      const old = interest.snapshot.nodes.get(relative);
      if (JSON.stringify(old) !== JSON.stringify(node))
        await this.#changed(interest, relative, node, old ? "modified" : "created");
    }
    for (const relative of interest.snapshot.nodes.keys())
      if (!next.nodes.has(relative)) await this.#changed(interest, relative, undefined, "deleted");
    if (lost && this.#handles.has(interest.handleKey)) {
      this.#resync(interest, "RECOVERED");
      if (!interest.pendingResync) interest.reason = undefined;
    }
    interest.snapshot = next;
  }
  async #changed(
    interest: Interest,
    relative: string,
    node: WatchedNode | undefined,
    changeType: "created" | "modified" | "deleted",
  ) {
    this.options.checkMetadata?.(relative);
    let version = node?.version;
    if (node?.type === "file" && version === undefined) {
      try {
        version = (await readEditableFile(interest.scope.root, relative)).version;
      } catch (error) {
        if (
          !(error instanceof FileManagerError) ||
          !["FILE_NOT_EDITABLE", "PAYLOAD_TOO_LARGE"].includes(error.code)
        )
          throw error;
      }
    }
    if (this.#closed || this.#interests.get(interest.key) !== interest) return;
    assertFileScopeMetadata(this.options.db, interest.scope);
    const cached = getCachedFile(this.options.db, interest.scope.key, relative);
    if (version !== undefined && cached?.versionHash === version) return; // API save already persisted this version.
    const event = immediateTransaction(this.options.db, (tx) => {
      if (version && node)
        cacheFileVersion(tx, {
          scopeKey: interest.scope.key,
          path: relative,
          realPath: path.join(interest.scope.root, ...relative.split("/")),
          versionHash: version,
          size: node.size,
          mtime: Math.trunc(node.mtime),
          updatedAt: Date.now(),
        });
      else deleteCachedFile(tx, interest.scope.key, relative);
      return appendResourceEvent(
        tx,
        interest.stream,
        "file.changed",
        { path: relative, changeType, ...(version ? { version } : {}) },
        Date.now(),
      );
    });
    this.options.events.publish(event);
  }
  async close() {
    this.#closed = true;
    clearInterval(this.#timer);
    clearTimeout(this.#debounce);
    for (const handle of this.#handles.values()) handle.watcher.close();
    this.#handles.clear();
    this.#pending.clear();
    this.#interests.clear();
    await this.#running;
  }
}
