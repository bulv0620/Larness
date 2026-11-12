import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { FileManagerError, resolveFilePath, runCommand } from "@larness/resources";
import {
  COMMAND_OUTPUT_RETENTION_MS,
  COMMAND_RETENTION_MS,
  CommandParamsSchema,
  type CommandStatus,
} from "@larness/shared";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { CommandExecutionRow, ResourceOperationRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import { assertFileScopeMetadata, authorizeFileTarget, resolveFileScope } from "../files/scope.js";
import {
  acquireResourceLock,
  findResourceLock,
  type ResourceLockHandle,
  releaseResourceLock,
  renewResourceLock,
} from "../locks/service.js";
import { listEncryptedSecrets } from "../models/repository.js";
import type { ResourceEventBus } from "../resources/events.js";
import {
  appendResourceEvent,
  findOperation,
  insertOperation,
  resourceSequence,
  updateOperation,
} from "../resources/repository.js";
import { getSessionById, getTurnById } from "../sessions/repository.js";
import { CommandOutputFile, readCommandOutput, removeCommandOutput } from "./output.js";
import {
  activeCommandClient,
  commandByOperation,
  commandRow,
  deleteCommand,
  insertCommand,
  oldCommands,
  operationRow,
  unfinishedCommands,
  updateCommand,
} from "./repository.js";

const ContextSchema = z.object({
  sessionId: z.string().min(1).max(128),
  turnId: z.string().min(1).max(128),
  toolCallId: z.string().min(1).max(128),
  policySnapshotId: z.string().min(1).max(128),
  clientSessionId: z.string().min(1).max(128),
  remainingMs: z.number().int().min(1).max(86_400_000),
});
export interface CommandContext extends z.infer<typeof ContextSchema> {
  assertAuthorized: () => void;
  signal?: AbortSignal;
  inheritedLock?: ResourceLockHandle;
  onCreated?: (id: string) => void;
  /** True when the owning Turn has exhausted its duration budget. */
  isBudgetExpired?: () => boolean;
}
interface Runtime {
  controller: AbortController;
  done: Promise<CommandExecutionRow>;
  reason?: string;
  output: CommandOutputFile;
}
export interface CommandManagerOptions {
  db: Database;
  dataDir: string;
  events: ResourceEventBus;
  secretStore?: SecretStore;
  now?: () => number;
  lockTtlMs?: number;
  heartbeatMs?: number;
  idleTtlMinutes?: number;
  environment?: () => { env: NodeJS.ProcessEnv; pm2Home: string };
}
export class CommandManager {
  readonly #active = new Map<string, Runtime>();
  readonly #instance = randomUUID();
  readonly #cleanup: ReturnType<typeof setInterval>;
  #closed = false;
  constructor(readonly options: CommandManagerOptions) {
    this.#cleanup = setInterval(() => {
      void this.cleanup().catch(() => {});
    }, 10 * 60_000);
    this.#cleanup.unref();
  }
  #now() {
    return this.options.now?.() ?? Date.now();
  }
  #require(id: string) {
    const row = commandRow(this.options.db, id);
    if (!row) throw new FileManagerError("NOT_FOUND", "Command not found");
    return row;
  }
  #scope(row: CommandExecutionRow) {
    return row.projectId
      ? { projectId: row.projectId }
      : { sessionId: row.workspaceSessionId ?? row.sessionId };
  }
  async authorize(id: string) {
    const row = this.#require(id);
    const scope = await resolveFileScope(this.options.db, this.options.dataDir, this.#scope(row));
    assertFileScopeMetadata(this.options.db, scope);
    return this.#require(id);
  }
  dto(row: CommandExecutionRow) {
    return {
      id: row.id,
      scope: this.#scope(row),
      status: row.status,
      exitCode: row.exitCode,
      reasonCode: row.reasonCode,
      truncated: row.truncated,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      currentSequence: resourceSequence(this.options.db, row.id),
    };
  }
  #writeStatus(
    tx: DbExecutor,
    id: string,
    fields: Partial<CommandExecutionRow>,
    action: string,
    client?: string,
  ) {
    updateCommand(tx, id, fields);
    const row = commandRow(tx, id);
    if (!row) throw new Error("Missing command");
    appendAudit(tx, {
      action,
      decision: "allow",
      clientSessionId: client,
      sessionId: row.sessionId,
      resourceType: "command",
      resourceId: id,
      details: {
        turnId: row.turnId,
        toolCallId: row.toolCallId,
        policySnapshotId: row.policySnapshotId,
        projectId: row.projectId,
        workspaceSessionId: row.workspaceSessionId,
        status: row.status,
        reasonCode: row.reasonCode,
      },
    });
    return appendResourceEvent(
      tx,
      id,
      "command.status",
      {
        status: row.status,
        exitCode: row.exitCode,
        reasonCode: row.reasonCode,
        truncated: row.truncated,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      },
      this.#now(),
    );
  }
  #status(
    id: string,
    fields: Partial<CommandExecutionRow>,
    action: string,
    client?: string,
    change?: (tx: DbExecutor) => void,
  ) {
    const event = immediateTransaction(this.options.db, (tx) => {
      change?.(tx);
      return this.#writeStatus(tx, id, fields, action, client);
    });
    this.options.events.publish(event);
  }
  #assertLock(lock: ResourceLockHandle) {
    const current = findResourceLock(this.options.db, lock.resourceType, lock.resourceId);
    if (
      !current ||
      current.id !== lock.id ||
      current.fencingToken !== lock.fencingToken ||
      current.executionId !== lock.executionId ||
      current.expiresAt <= this.#now()
    )
      throw new FileManagerError("RESOURCE_LOCKED", "Command lock was lost");
  }
  async execute(context: CommandContext, input: unknown) {
    try {
      return await this.#execute(context, input);
    } catch (error) {
      const failure =
        error instanceof FileManagerError
          ? error
          : new FileManagerError("INTERNAL", "Command operation failed");
      try {
        appendAudit(this.options.db, {
          action: "command.denied",
          decision: "deny",
          resourceType: "command",
          details: { code: failure.code },
        });
      } catch {
        throw new FileManagerError("INTERNAL", "Command audit unavailable");
      }
      throw failure;
    }
  }
  async #execute(context: CommandContext, input: unknown) {
    const began = Date.now();
    const parsed = CommandParamsSchema.safeParse(input);
    if (!parsed.success || !ContextSchema.safeParse(context).success)
      throw new FileManagerError("VALIDATION_ERROR", "Invalid command request");
    if (this.#closed)
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Command execution unavailable");
    const params = parsed.data;
    const session = getSessionById(this.options.db, context.sessionId);
    const turn = getTurnById(this.options.db, context.turnId);
    if (
      session?.status !== "active" ||
      !turn ||
      turn.sessionId !== session.id ||
      !activeCommandClient(
        this.options.db,
        context.clientSessionId,
        this.#now(),
        this.options.idleTtlMinutes,
      )
    )
      throw new FileManagerError("FORBIDDEN", "Command context is not active");
    const resolved = await resolveFileScope(
      this.options.db,
      this.options.dataDir,
      session.projectId ? { projectId: session.projectId } : { sessionId: session.id },
    );
    const cwd = await authorizeFileTarget(resolved, params.cwd);
    const absolute = await resolveFilePath(resolved.root, cwd);
    if (!(await lstat(absolute)).isDirectory())
      throw new FileManagerError("VALIDATION_ERROR", "Command cwd must be a directory");
    const encrypted = listEncryptedSecrets(this.options.db);
    if (encrypted.length && !this.options.secretStore)
      throw new FileManagerError("INTERNAL", "Output protection unavailable");
    const secrets = encrypted
      .map((secret) => this.options.secretStore?.decrypt(secret) ?? "")
      .filter(Boolean);
    if (
      secrets.some((secret) =>
        [params.executable, params.cwd, ...params.args].some((value) => value.includes(secret)),
      )
    )
      throw new FileManagerError("FORBIDDEN", "Protected credentials cannot be command arguments");
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          sessionId: session.id,
          turnId: turn.id,
          policy: context.policySnapshotId,
          root: resolved.root,
          ...params,
          cwd,
        }),
      )
      .digest("hex");
    const retryKey = createHash("sha256")
      .update(JSON.stringify([context.turnId, context.toolCallId]))
      .digest("hex");
    const existing = findOperation(
      this.options.db,
      context.clientSessionId,
      retryKey,
      "command.run",
    );
    if (existing) {
      if (existing.paramsHash !== hash)
        throw new FileManagerError("CONFLICT", "Command retry parameters changed");
      const row = commandByOperation(this.options.db, existing.id);
      if (!row) throw new FileManagerError("RESOURCE_UNAVAILABLE", "Command result unavailable");
      const active = this.#active.get(row.id);
      if (!active && ["CREATED", "RUNNING", "CANCELLING"].includes(row.status))
        throw new FileManagerError("RESOURCE_UNAVAILABLE", "Command requires recovery");
      return active ? active.done : row;
    }
    if (!["RUNNING", "PREPARING"].includes(turn.status))
      throw new FileManagerError("FORBIDDEN", "Command Turn is not active");
    if (this.#closed)
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Command manager is stopping");
    assertFileScopeMetadata(this.options.db, resolved);
    context.assertAuthorized();
    const id = newId("cmd"),
      operationId = newId("rop");
    const own = context.inheritedLock === undefined;
    const prepared = immediateTransaction(this.options.db, (tx) => {
      let lock: ResourceLockHandle | null = null;
      if (context.inheritedLock) {
        lock = context.inheritedLock;
        this.#assertLock(lock);
        if (lock.executionId !== context.turnId || lock.rootRealPath !== resolved.root)
          throw new FileManagerError("FORBIDDEN", "Inherited lock does not match command");
      } else
        lock = acquireResourceLock(
          { db: this.options.db, now: () => this.#now() },
          {
            resourceType: "project",
            resourceId: resolved.key,
            rootRealPath: resolved.root,
            owner: context.clientSessionId,
            executionId: id,
            ttlMs: this.options.lockTtlMs ?? 30_000,
          },
        );
      if (!lock) throw new FileManagerError("RESOURCE_LOCKED", "Command root is busy");
      const operation: ResourceOperationRow = {
        id: operationId,
        scopeKey: resolved.key,
        rootRealPath: resolved.root,
        kind: "command.run",
        status: "PREPARED",
        paramsHash: hash,
        idempotencyKey: retryKey,
        clientSessionId: context.clientSessionId,
        path: cwd,
        expectedVersion: "",
        targetVersion: "",
        lockId: lock.id,
        fencingToken: lock.fencingToken,
        resultJson: null,
        errorCode: null,
        createdAt: this.#now(),
        updatedAt: this.#now(),
      };
      insertOperation(tx, operation);
      const row: CommandExecutionRow = {
        id,
        operationId,
        projectId: session.projectId,
        workspaceSessionId: session.projectId ? null : session.id,
        sessionId: session.id,
        turnId: turn.id,
        toolCallId: context.toolCallId,
        policySnapshotId: context.policySnapshotId,
        paramsHash: hash,
        status: "CREATED",
        exitCode: null,
        reasonCode: null,
        truncated: false,
        processIdentityJson: null,
        outputCursor: 0,
        createdAt: this.#now(),
        startedAt: null,
        endedAt: null,
      };
      insertCommand(tx, row);
      const event = this.#writeStatus(
        tx,
        id,
        { status: "CREATED" },
        "command.created",
        context.clientSessionId,
      );
      return { row, lock, event };
    });
    const { row, lock: held } = prepared;
    this.options.events.publish(prepared.event);
    let output: CommandOutputFile;
    try {
      context.onCreated?.(id);
      output = new CommandOutputFile(this.options.dataDir, id);
    } catch {
      this.#status(
        id,
        { status: "FAILED", reasonCode: "OUTPUT_FAILED", endedAt: this.#now() },
        "command.failed",
        context.clientSessionId,
        (tx) => {
          updateOperation(tx, operationId, {
            status: "FAILED",
            errorCode: "INTERNAL",
            updatedAt: this.#now(),
          });
        },
      );
      if (own) releaseResourceLock({ db: this.options.db }, held);
      throw new FileManagerError("INTERNAL", "Command preparation failed");
    }
    const runtime: Runtime = {
      controller: new AbortController(),
      output,
      done: Promise.resolve(row),
    };
    this.#active.set(id, runtime);
    const abort = () => {
      runtime.reason ??= context.isBudgetExpired?.() ? "TIMED_OUT" : "CANCELLED";
      runtime.controller.abort();
    };
    context.signal?.addEventListener("abort", abort, { once: true });
    if (context.signal?.aborted) abort();
    runtime.done = (async () => {
      const interval = setInterval(() => {
        try {
          this.#assertLock(held);
          if (
            own &&
            !renewResourceLock(
              { db: this.options.db, now: () => this.#now() },
              {
                id: held.id,
                fencingToken: held.fencingToken,
                ttlMs: this.options.lockTtlMs ?? 30_000,
              },
            )
          )
            throw new Error("Lock lost");
          const current = getTurnById(this.options.db, turn.id);
          if (!current || !["RUNNING", "PREPARING"].includes(current.status)) {
            runtime.reason ??= "CANCELLED";
            runtime.controller.abort();
          }
        } catch {
          runtime.reason ??= "LOCK_LOST";
          runtime.controller.abort();
        }
      }, this.options.heartbeatMs ?? 1000);
      interval.unref();
      let state: CommandStatus = "FAILED",
        reasonCode: string | null = "START_RECORD_FAILED",
        exitCode: number | null = null,
        stopped = true,
        truncated = false;
      try {
        this.#assertLock(held);
        context.assertAuthorized();
        assertFileScopeMetadata(this.options.db, resolved);
        const currentRoot = await resolveFileScope(
          this.options.db,
          this.options.dataDir,
          resolved.scope,
        );
        const currentCwd = await authorizeFileTarget(currentRoot, cwd);
        if (currentRoot.root !== resolved.root || currentCwd !== cwd)
          throw new Error("Cwd changed");
        if (this.#closed) throw new Error("Command manager is stopping");
        this.#assertLock(held);
        assertFileScopeMetadata(this.options.db, resolved);
        context.assertAuthorized();
        if (
          !activeCommandClient(
            this.options.db,
            context.clientSessionId,
            this.#now(),
            this.options.idleTtlMinutes,
          )
        )
          throw new Error("Client revoked");
        const remaining = Math.min(params.timeoutMs, context.remainingMs - (Date.now() - began));
        if (remaining <= 0) {
          reasonCode = "TIMED_OUT";
          state = "TIMED_OUT";
        } else {
          updateOperation(this.options.db, operationId, {
            status: "WRITING",
            updatedAt: this.#now(),
          });
          const result = await runCommand({
            ...params,
            ...this.options.environment?.(),
            cwd: absolute,
            timeoutMs: remaining,
            signal: runtime.controller.signal,
            secrets,
            onSpawn: (pid) => {
              this.#assertLock(held);
              this.#status(
                id,
                {
                  status: "RUNNING",
                  startedAt: this.#now(),
                  processIdentityJson: JSON.stringify({
                    pid,
                    pgid: pid,
                    instance: this.#instance,
                    launchId: randomUUID(),
                    startedAt: this.#now(),
                  }),
                },
                "command.started",
                context.clientSessionId,
              );
            },
            onOutput: (chunk) => {
              const stored = output.append(chunk);
              if (stored)
                this.options.events.publishOutput({
                  kind: "command.output",
                  resourceId: id,
                  ...stored,
                });
            },
          });
          exitCode = result.exitCode;
          stopped = result.stopped;
          truncated = result.truncated || output.truncated;
          reasonCode = result.stopped ? (runtime.reason ?? result.reasonCode) : "STOP_UNCONFIRMED";
          state =
            !stopped || reasonCode === "LOCK_LOST" || reasonCode === "SERVER_SHUTDOWN"
              ? "INTERRUPTED"
              : reasonCode === "TIMED_OUT"
                ? "TIMED_OUT"
                : reasonCode === "CANCELLED"
                  ? "CANCELLED"
                  : reasonCode !== null
                    ? "FAILED"
                    : "COMPLETED";
        }
      } catch {
        reasonCode = runtime.reason ?? "START_RECORD_FAILED";
        state =
          reasonCode === "SERVER_SHUTDOWN" || reasonCode === "LOCK_LOST"
            ? "INTERRUPTED"
            : reasonCode === "CANCELLED"
              ? "CANCELLED"
              : "FAILED";
      } finally {
        clearInterval(interval);
        context.signal?.removeEventListener("abort", abort);
        try {
          output.close();
        } catch {
          state = "FAILED";
          reasonCode = "OUTPUT_FAILED";
          truncated = true;
        }
      }
      try {
        this.#status(
          id,
          {
            status: state,
            reasonCode,
            exitCode,
            truncated,
            outputCursor: output.cursor,
            endedAt: this.#now(),
          },
          "command.finished",
          context.clientSessionId,
          (tx) => {
            updateOperation(tx, operationId, {
              status: stopped
                ? state === "COMPLETED"
                  ? "COMPLETED"
                  : "FAILED"
                : "RECONCILIATION_REQUIRED",
              errorCode: reasonCode,
              resultJson: JSON.stringify({ commandId: id }),
              updatedAt: this.#now(),
            });
          },
        );
        if (own && stopped)
          releaseResourceLock({ db: this.options.db, now: () => this.#now() }, held);
      } catch {
        try {
          updateOperation(this.options.db, operationId, {
            status: "RECONCILIATION_REQUIRED",
            errorCode: "INTERNAL",
            updatedAt: this.#now(),
          });
        } catch {
          /* Persisted WRITING remains a conflict barrier. */
        }
        throw new FileManagerError("INTERNAL", "Command completion could not be recorded");
      } finally {
        this.#active.delete(id);
      }
      return this.#require(id);
    })();
    return runtime.done;
  }
  async read(id: string) {
    return this.dto(await this.authorize(id));
  }
  async output(id: string, after: number, limit: number) {
    const row = await this.authorize(id);
    const expired = row.endedAt !== null && row.endedAt < this.#now() - COMMAND_OUTPUT_RETENTION_MS;
    const chunks = expired ? null : await readCommandOutput(this.options.dataDir, id);
    await this.authorize(id);
    const lastStored = chunks?.at(-1)?.cursor ?? 0;
    const current = Math.max(
      lastStored,
      row.outputCursor,
      this.#active.get(id)?.output.cursor ?? 0,
    );
    if (after > current)
      throw new FileManagerError("VALIDATION_ERROR", "Output cursor is in the future");
    const items = (chunks ?? []).filter((chunk) => chunk.cursor > after).slice(0, limit);
    const resyncRequired =
      chunks === null
        ? current > 0 || row.startedAt !== null
        : chunks.some((chunk, index) => chunk.cursor !== index + 1) || lastStored < current;
    return {
      chunks: items,
      oldestCursor: chunks?.[0]?.cursor ?? current + 1,
      nextCursor: items.at(-1)?.cursor ?? (resyncRequired ? current : after),
      truncated: row.truncated || (this.#active.get(id)?.output.truncated ?? false),
      resyncRequired,
    };
  }
  async cancel(id: string, client?: string, assertClient?: () => void) {
    await this.authorize(id);
    assertClient?.();
    const runtime = this.#active.get(id);
    if (runtime && !runtime.controller.signal.aborted) {
      this.#status(id, { status: "CANCELLING" }, "command.cancelled", client);
      runtime.reason = "CANCELLED";
      runtime.controller.abort();
    }
    if (runtime) await runtime.done;
    return this.read(id);
  }
  async recover() {
    for (const row of unfinishedCommands(this.options.db)) {
      const operation = operationRow(this.options.db, row.operationId);
      const safe = operation?.status === "PREPARED" && row.processIdentityJson === null;
      this.#status(
        row.id,
        {
          status: "INTERRUPTED",
          reasonCode: safe ? "NOT_STARTED" : "RECOVERY_UNCONFIRMED",
          endedAt: this.#now(),
        },
        "command.interrupted",
        undefined,
        (tx) => {
          updateOperation(tx, row.operationId, {
            status: safe ? "FAILED" : "RECONCILIATION_REQUIRED",
            errorCode: "RESOURCE_UNAVAILABLE",
            updatedAt: this.#now(),
          });
        },
      );
      if (safe && operation)
        releaseResourceLock(
          { db: this.options.db },
          { id: operation.lockId, fencingToken: operation.fencingToken },
        );
    }
    await this.cleanup();
  }
  async cleanup() {
    for (const row of oldCommands(this.options.db, this.#now() - COMMAND_OUTPUT_RETENTION_MS)) {
      if (this.#active.has(row.id)) continue;
      await removeCommandOutput(this.options.dataDir, row.id);
      if ((row.endedAt ?? Infinity) < this.#now() - COMMAND_RETENTION_MS)
        immediateTransaction(this.options.db, (tx) => deleteCommand(tx, row));
    }
  }
  async close() {
    this.#closed = true;
    clearInterval(this.#cleanup);
    for (const runtime of this.#active.values()) {
      runtime.reason ??= "SERVER_SHUTDOWN";
      runtime.controller.abort();
    }
    await Promise.allSettled([...this.#active.values()].map((runtime) => runtime.done));
  }
}
