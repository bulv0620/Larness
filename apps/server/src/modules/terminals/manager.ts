import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import {
  commandEnvironment,
  FileManagerError,
  isInsideRoot,
  ManagedPty,
  OutputRedactor,
  resolveFilePath,
} from "@larness/resources";
import {
  DEFAULT_PROJECT_ID,
  type FileScope,
  TERMINAL_LEASE_TTL_MS,
  TerminalCreateSchema,
  TerminalDevSchema,
  TerminalRenameSchema,
} from "@larness/shared";
import { spawn } from "node-pty";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { TerminalLeaseRow, TerminalRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import { activeCommandClient } from "../commands/repository.js";
import { assertFileScopeMetadata, authorizeFileTarget, resolveFileScope } from "../files/scope.js";
import { clearRootQuarantine, quarantineRoot, rootIsQuarantined } from "../locks/quarantine.js";
import { rootHasWriter } from "../locks/repository.js";
import { listEncryptedSecrets } from "../models/repository.js";
import { getProjectById } from "../projects/repository.js";
import type { ResourceEventBus } from "../resources/events.js";
import {
  appendResourceEvent,
  findOperation,
  insertOperation,
  pendingOperations,
  resourceSequence,
  updateOperation,
} from "../resources/repository.js";
import { getSessionById, getTurnById } from "../sessions/repository.js";
import { isDefaultWorkspace } from "../workspaces/default.js";
import { TerminalOutput } from "./output.js";
import {
  activeTerminals,
  allTerminals,
  deleteTerminal,
  insertTerminal,
  leaseRow,
  oldTerminals,
  terminalRow,
  updateLease,
  updateTerminal,
} from "./repository.js";
import { resolveManualShell, terminalLaunch } from "./shell.js";

interface Connection {
  clientId: string;
  active: () => boolean;
  subscriptions: Set<string>;
  bytes: number;
  resetAt: number;
}
interface Runtime {
  root: string;
  operationId: string;
  pty: ManagedPty;
  output: TerminalOutput;
  done: Promise<void>;
  reason?: string;
}
export interface TerminalManagerOptions {
  spawnPty?: typeof spawn;
  db: Database;
  dataDir: string;
  events: ResourceEventBus;
  secretStore?: SecretStore;
  now?: () => number;
  idleTtlMinutes?: number;
  outputLimits?: { perTerminal: number; total: number };
}
export interface DevContext {
  clientSessionId: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  policySnapshotId: string;
  assertAuthorized: () => void;
  signal?: AbortSignal;
}
export interface AgentTerminalContext {
  clientSessionId: string;
  projectId: string | null;
  sessionId: string;
  turnId: string;
  toolCallId: string;
  assertAuthorized?: () => void;
  signal?: AbortSignal;
}
const CLEARED = {
  ownerType: null,
  ownerClientSessionId: null,
  ownerConnectionId: null,
  ownerSessionId: null,
  ownerTurnId: null,
  ownerExecutionId: null,
  expiresAt: 0,
  heartbeatAt: 0,
  inputSequence: 0,
} as const;
function fail(code: ConstructorParameters<typeof FileManagerError>[0], message: string): never {
  throw new FileManagerError(code, message);
}
export class TerminalManager {
  readonly #active = new Map<string, Runtime>();
  readonly #connections = new Map<string, Connection>();
  readonly #creating = new Map<string, Promise<ReturnType<TerminalManager["dto"]>>>();
  readonly #agentRate = new Map<string, { bytes: number; resetAt: number }>();
  readonly #instance = randomUUID();
  readonly #timer: ReturnType<typeof setInterval>;
  #closed = false;
  #lastCleanup = Date.now();
  constructor(readonly options: TerminalManagerOptions) {
    this.#timer = setInterval(() => {
      try {
        this.expireLeases();
        this.renewAgentLeases();
        if (this.#now() - this.#lastCleanup > 600000) {
          this.#lastCleanup = this.#now();
          void this.cleanup().catch(() => {});
        }
        for (const [id, runtime] of this.#active) {
          try {
            this.assertMetadata(id);
          } catch {
            runtime.reason = "SCOPE_UNAVAILABLE";
            void runtime.pty.stop();
          }
        }
      } catch {
        for (const runtime of this.#active.values()) {
          quarantineRoot(runtime.operationId, runtime.root);
          runtime.reason ??= "CONTROL_UNAVAILABLE";
          void runtime.pty.stop();
        }
      }
    }, 1000);
    this.#timer.unref();
  }
  #now() {
    return this.options.now?.() ?? Date.now();
  }
  #row(id: string) {
    return terminalRow(this.options.db, id) ?? fail("NOT_FOUND", "Terminal not found");
  }
  #client(id: string) {
    if (!activeCommandClient(this.options.db, id, this.#now(), this.options.idleTtlMinutes))
      fail("UNAUTHENTICATED", "Client session is not active");
  }
  #lease(id: string, tx: DbExecutor = this.options.db) {
    const row = leaseRow(tx, id);
    if (!row?.ownerType || row.expiresAt <= this.#now()) return null;
    return {
      ownerType: row.ownerType,
      ownerClientSessionId: row.ownerClientSessionId,
      ownerConnectionId: row.ownerConnectionId,
      ownerTurnId: row.ownerTurnId,
      ownerExecutionId: row.ownerExecutionId,
      generation: row.generation,
      expiresAt: row.expiresAt,
    };
  }
  dto(row: TerminalRow) {
    const operation = findOperationById(this.options.db, row.operationId);
    return {
      writeBlocked: operation
        ? rootHasWriter(this.options.db, operation.rootRealPath, this.#now())
        : true,
      id: row.id,
      projectId: row.projectId,
      workspaceSessionId: row.workspaceSessionId,
      sourceSessionId: row.sourceSessionId,
      executionId: row.id,
      cwd: operation ? path.resolve(operation.rootRealPath, row.cwd) : row.cwd,
      shell: row.shell,
      mode: row.mode,
      role: row.role,
      title: row.title,
      status: row.status,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      exitCode: row.exitCode,
      reasonCode: row.reasonCode,
      currentSequence: resourceSequence(this.options.db, row.id),
      lease: this.#lease(row.id),
    };
  }
  #event(tx: DbExecutor, id: string, type: string, action: string, client?: string) {
    const row = terminalRow(tx, id);
    if (!row) throw new Error("Missing terminal");
    appendAudit(tx, {
      action,
      decision: row.status === "INTERRUPTED" ? "deny" : "allow",
      clientSessionId: client,
      sessionId: row.sourceSessionId ?? undefined,
      resourceType: "terminal",
      resourceId: id,
      details: {
        status: row.status,
        reasonCode: row.reasonCode,
        projectId: row.projectId,
        workspaceSessionId: row.workspaceSessionId,
      },
      now: this.#now(),
    });
    return appendResourceEvent(
      tx,
      id,
      type,
      {
        status: row.status,
        exitCode: row.exitCode,
        reasonCode: row.reasonCode,
        lease: this.#lease(id, tx),
      },
      this.#now(),
    );
  }
  #status(
    id: string,
    fields: Partial<TerminalRow>,
    type: string,
    action: string,
    client?: string,
    change?: (tx: DbExecutor) => void,
  ) {
    const event = immediateTransaction(this.options.db, (tx) => {
      change?.(tx);
      updateTerminal(tx, id, fields);
      return this.#event(tx, id, type, action, client);
    });
    this.options.events.publish(event);
  }
  async #scope(scope?: FileScope) {
    return resolveFileScope(
      this.options.db,
      this.options.dataDir,
      scope ?? { workspace: "default" },
    );
  }
  assertMetadata(id: string) {
    const row = this.#row(id),
      op = findOperationById(this.options.db, row.operationId);
    if (!op) fail("RESOURCE_UNAVAILABLE", "Terminal operation unavailable");
    if (row.projectId) {
      const project = getProjectById(this.options.db, row.projectId);
      if (!project) fail("NOT_FOUND", "Terminal project not found");
      if (project.realPath !== op.rootRealPath) fail("FORBIDDEN", "Terminal project changed");
    } else if (row.workspaceSessionId) {
      const session = getSessionById(this.options.db, row.workspaceSessionId);
      if (
        !session ||
        session.projectId ||
        path.resolve(session.workspacePath) !==
          path.resolve(this.options.dataDir, "sessions", session.id, "workspace")
      )
        fail("FORBIDDEN", "Terminal workspace changed");
    }
  }
  async authorize(id: string) {
    this.assertMetadata(id);
    const row = this.#row(id);
    await this.#scope(
      row.projectId
        ? { projectId: row.projectId }
        : row.workspaceSessionId
          ? { sessionId: row.workspaceSessionId }
          : undefined,
    );
    return this.#row(id);
  }
  async read(id: string) {
    const row = await this.authorize(id);
    if (["RUNNING", "STOPPING"].includes(row.status) && !this.#active.has(id))
      fail("RESOURCE_UNAVAILABLE", "Terminal execution requires reconciliation");
    return this.dto(row);
  }
  async activeDevByRole(projectId: string, role: string) {
    const row = activeTerminals(this.options.db).find(
      (item) => item.projectId === projectId && item.role === role && item.mode === "dev",
    );
    return row ? this.dto(row) : null;
  }
  async rename(id: string, client: string, input: unknown) {
    const parsed = TerminalRenameSchema.safeParse(input);
    if (!parsed.success) fail("VALIDATION_ERROR", "Invalid terminal title");
    const title = parsed.data.title;
    this.#client(client);
    await this.authorize(id);
    for (const secret of listEncryptedSecrets(this.options.db)) {
      const value = this.options.secretStore?.decrypt(secret);
      if (!value) fail("RESOURCE_UNAVAILABLE", "Terminal title protection unavailable");
      if (title.includes(value)) fail("VALIDATION_ERROR", "Protected title rejected");
    }
    const event = immediateTransaction(this.options.db, (tx) => {
      this.#client(client);
      updateTerminal(tx, id, { title });
      return this.#event(tx, id, "terminal.status", "terminal.renamed", client);
    });
    this.options.events.publish(event);
    return this.read(id);
  }
  async readSessionTerminal(id: string, sessionId: string) {
    const session = getSessionById(this.options.db, sessionId);
    if (session?.status !== "active") fail("FORBIDDEN", "Terminal session unavailable");
    const scope = await resolveFileScope(
      this.options.db,
      this.options.dataDir,
      session.projectId ? { projectId: session.projectId } : { sessionId },
    );
    const row = await this.read(id);
    const operation = findOperationById(this.options.db, this.#row(id).operationId);
    if (row.projectId !== session.projectId || operation?.rootRealPath !== scope.root)
      fail("FORBIDDEN", "Terminal does not belong to this workspace");
    return row;
  }
  async readSessionTerminalOutput(id: string, sessionId: string, after: number, limit: number) {
    await this.readSessionTerminal(id, sessionId);
    return this.output(id, after, limit);
  }
  async readProjectTerminal(id: string, projectId: string) {
    const row = await this.read(id);
    if (row.projectId !== projectId) fail("FORBIDDEN", "Terminal does not belong to this project");
    return row;
  }
  async readProjectTerminalOutput(id: string, projectId: string, after: number, limit: number) {
    await this.readProjectTerminal(id, projectId);
    return this.output(id, after, limit);
  }
  async readProjectDev(id: string, projectId: string) {
    const row = await this.read(id);
    if (row.projectId !== projectId || row.mode !== "dev" || this.#row(id).createdByTurnId === null)
      fail("FORBIDDEN", "Terminal does not belong to this project");
    return row;
  }
  async readProjectDevOutput(id: string, projectId: string, after: number, limit: number) {
    await this.readProjectDev(id, projectId);
    return this.output(id, after, limit);
  }
  async stopProjectDev(id: string, projectId: string, client: string) {
    await this.readProjectDev(id, projectId);
    return this.terminate(id, client);
  }
  #agentContext(context: AgentTerminalContext) {
    const turn = getTurnById(this.options.db, context.turnId);
    const session = getSessionById(this.options.db, context.sessionId);
    if (
      !turn ||
      !["RUNNING", "PREPARING", "WAITING_APPROVAL"].includes(turn.status) ||
      turn.sessionId !== context.sessionId ||
      session?.projectId !== context.projectId
    )
      fail("FORBIDDEN", "Invalid terminal control context");
    this.#client(context.clientSessionId);
    if (context.signal?.aborted) fail("RESOURCE_UNAVAILABLE", "Terminal control cancelled");
  }
  #agentHeld(id: string, context: AgentTerminalContext, generation: number) {
    const lease = leaseRow(this.options.db, id);
    if (
      lease?.ownerType !== "agent" ||
      lease.ownerTurnId !== context.turnId ||
      lease.ownerSessionId !== context.sessionId ||
      lease.ownerClientSessionId !== context.clientSessionId ||
      lease.expiresAt <= this.#now() ||
      lease.generation !== generation
    )
      fail("TERMINAL_LEASE_REQUIRED", "Current agent terminal lease required");
    if (this.#row(id).status !== "RUNNING" || !this.#active.get(id)?.pty.controlAvailable)
      fail("RESOURCE_UNAVAILABLE", "Terminal is not running");
    return lease;
  }
  async acquireAgent(id: string, context: AgentTerminalContext) {
    await this.readSessionTerminal(id, context.sessionId);
    this.#agentContext(context);
    if (this.#row(id).status !== "RUNNING" || !this.#active.get(id)?.pty.controlAvailable)
      fail("RESOURCE_UNAVAILABLE", "Terminal is not running");
    const event = immediateTransaction(this.options.db, (tx) => {
      context.assertAuthorized?.();
      const current = leaseRow(tx, id);
      if (!current) throw new Error("Missing terminal lease");
      if (current.expiresAt > this.#now() && current.ownerType) {
        if (
          current.ownerType !== "agent" ||
          current.ownerTurnId !== context.turnId ||
          current.ownerClientSessionId !== context.clientSessionId
        )
          fail("TERMINAL_LEASE_REQUIRED", "Terminal is controlled by another principal");
        updateLease(tx, id, {
          expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
          heartbeatAt: this.#now(),
        });
      } else
        updateLease(tx, id, {
          ownerType: "agent",
          ownerClientSessionId: context.clientSessionId,
          ownerConnectionId: null,
          ownerSessionId: context.sessionId,
          ownerTurnId: context.turnId,
          ownerExecutionId: context.toolCallId,
          generation: current.generation + 1,
          expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
          heartbeatAt: this.#now(),
          inputSequence: 0,
        });
      return this.#event(
        tx,
        id,
        "terminal.lease",
        "terminal.lease.acquired",
        context.clientSessionId,
      );
    });
    this.options.events.publish(event);
    return this.read(id);
  }
  async inputAgent(
    id: string,
    context: AgentTerminalContext,
    generation: number,
    sequence: number,
    data: string,
  ) {
    await this.readSessionTerminal(id, context.sessionId);
    this.#agentContext(context);
    if (Buffer.byteLength(data) > 8192) fail("PAYLOAD_TOO_LARGE", "Terminal input exceeds limit");
    const rateKey = `${context.turnId}:${id}`;
    const now = this.#now();
    let rate = this.#agentRate.get(rateKey);
    if (!rate || now - rate.resetAt >= 1000) {
      rate = { bytes: 0, resetAt: now };
      this.#agentRate.set(rateKey, rate);
    }
    if (rate.bytes + Buffer.byteLength(data) > 65536)
      fail("RATE_LIMITED", "Terminal input rate exceeded");
    const accepted = immediateTransaction(this.options.db, (tx) => {
      const lease = this.#agentHeld(id, context, generation);
      if (sequence <= lease.inputSequence) return false;
      if (sequence !== lease.inputSequence + 1)
        fail("VALIDATION_ERROR", "Terminal input sequence has a gap");
      appendAudit(tx, {
        action: "terminal.input",
        decision: "allow",
        clientSessionId: context.clientSessionId,
        sessionId: context.sessionId,
        resourceType: "terminal",
        resourceId: id,
        details: {
          bytes: Buffer.byteLength(data),
          generation,
          sequence,
          ownerType: "agent",
        },
        now: this.#now(),
      });
      updateLease(tx, id, {
        inputSequence: sequence,
        expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
        heartbeatAt: this.#now(),
      });
      return true;
    });
    if (accepted) {
      rate.bytes += Buffer.byteLength(data);
      try {
        this.#active.get(id)?.pty.native.write(data);
      } catch {
        fail("RESOURCE_UNAVAILABLE", "Terminal input failed");
      }
    }
    return { accepted, inputSequence: sequence };
  }
  async interruptAgent(id: string, context: AgentTerminalContext, generation: number) {
    await this.readSessionTerminal(id, context.sessionId);
    this.#agentContext(context);
    const lease = this.#agentHeld(id, context, generation);
    immediateTransaction(this.options.db, (tx) => {
      appendAudit(tx, {
        action: "terminal.interrupt",
        decision: "allow",
        clientSessionId: context.clientSessionId,
        sessionId: context.sessionId,
        resourceType: "terminal",
        resourceId: id,
        details: { bytes: 1, generation: lease.generation, ownerType: "agent" },
        now: this.#now(),
      });
    });
    try {
      this.#active.get(id)?.pty.native.write("\u0003");
    } catch {
      fail("RESOURCE_UNAVAILABLE", "Terminal interrupt failed");
    }
    return { sent: true as const, status: this.#row(id).status };
  }
  async releaseAgent(id: string, context: AgentTerminalContext, generation: number) {
    await this.readSessionTerminal(id, context.sessionId);
    this.#agentContext(context);
    const event = immediateTransaction(this.options.db, (tx) => {
      this.#agentHeld(id, context, generation);
      updateLease(tx, id, { ...CLEARED });
      appendAudit(tx, {
        action: "terminal.control.released",
        decision: "allow",
        clientSessionId: context.clientSessionId,
        sessionId: context.sessionId,
        resourceType: "terminal",
        resourceId: id,
        details: { generation, ownerType: "agent" },
        now: this.#now(),
      });
      return this.#event(
        tx,
        id,
        "terminal.lease",
        "terminal.lease.released",
        context.clientSessionId,
      );
    });
    this.options.events.publish(event);
    this.#agentRate.delete(`${context.turnId}:${id}`);
    return this.read(id);
  }
  releaseAgentLeases(turnId: string) {
    for (const row of allTerminals(this.options.db)) {
      const lease = leaseRow(this.options.db, row.id);
      if (lease?.ownerType !== "agent" || lease.ownerTurnId !== turnId) continue;
      this.#agentRate.delete(`${turnId}:${row.id}`);
      this.#clearLease(row.id);
    }
  }
  async takeover(id: string, client: string, connectionId: string) {
    await this.authorize(id);
    this.#connection(connectionId, client, id);
    if (this.#row(id).status !== "RUNNING" || !this.#active.get(id)?.pty.controlAvailable)
      fail("RESOURCE_UNAVAILABLE", "Terminal is not running");
    const event = immediateTransaction(this.options.db, (tx) => {
      const current = leaseRow(tx, id);
      if (!current) throw new Error("Missing terminal lease");
      if (current.expiresAt > this.#now() && current.ownerType === "human") {
        if (current.ownerConnectionId !== connectionId || current.ownerClientSessionId !== client)
          fail("TERMINAL_LEASE_REQUIRED", "Terminal is controlled by another human connection");
        updateLease(tx, id, {
          expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
          heartbeatAt: this.#now(),
        });
      } else {
        if (current.ownerType === "agent" && current.ownerTurnId)
          this.#agentRate.delete(`${current.ownerTurnId}:${id}`);
        updateLease(tx, id, {
          ownerType: "human",
          ownerClientSessionId: client,
          ownerConnectionId: connectionId,
          ownerSessionId: null,
          ownerTurnId: null,
          ownerExecutionId: null,
          generation: current.generation + 1,
          expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
          heartbeatAt: this.#now(),
          inputSequence: 0,
        });
        appendAudit(tx, {
          action: "terminal.takeover",
          decision: "allow",
          clientSessionId: client,
          resourceType: "terminal",
          resourceId: id,
          details: { generation: current.generation + 1, previous: current.ownerType ?? "none" },
          now: this.#now(),
        });
      }
      return this.#event(tx, id, "terminal.lease", "terminal.lease.takeover", client);
    });
    this.options.events.publish(event);
    return this.read(id);
  }
  renewAgentLeases() {
    const now = this.#now();
    for (const row of allTerminals(this.options.db)) {
      const lease = leaseRow(this.options.db, row.id);
      if (lease?.ownerType !== "agent") continue;
      const turn = lease.ownerTurnId ? getTurnById(this.options.db, lease.ownerTurnId) : null;
      if (
        !turn ||
        !["QUEUED", "PREPARING", "RUNNING", "WAITING_APPROVAL"].includes(turn.status) ||
        !activeCommandClient(
          this.options.db,
          lease.ownerClientSessionId ?? "",
          now,
          this.options.idleTtlMinutes,
        )
      ) {
        this.#clearLease(row.id);
        continue;
      }
      if (lease.expiresAt <= now + TERMINAL_LEASE_TTL_MS / 2)
        immediateTransaction(this.options.db, (tx) =>
          updateLease(tx, row.id, {
            expiresAt: now + TERMINAL_LEASE_TTL_MS,
            heartbeatAt: now,
          }),
        );
    }
  }
  async list(filter: {
    projectId?: string;
    workspaceSessionId?: string;
    global?: boolean;
    limit: number;
    cursor?: string;
  }) {
    let rows = allTerminals(this.options.db).filter(
      (row) =>
        (!filter.projectId ||
          (filter.projectId === DEFAULT_PROJECT_ID
            ? !row.projectId && !row.workspaceSessionId
            : row.projectId === filter.projectId)) &&
        (!filter.workspaceSessionId || row.workspaceSessionId === filter.workspaceSessionId) &&
        (!filter.global || (!row.projectId && !row.workspaceSessionId)),
    );
    if (filter.cursor) {
      const index = rows.findIndex((row) => row.id === filter.cursor);
      if (index < 0) fail("VALIDATION_ERROR", "Invalid terminal cursor");
      rows = rows.slice(index + 1);
    }
    const items = [];
    for (const row of rows) {
      try {
        items.push(await this.read(row.id));
      } catch (error) {
        if (!(error instanceof FileManagerError && error.code === "NOT_FOUND")) throw error;
      }
      if (items.length > filter.limit) break;
    }
    const more = items.length > filter.limit;
    if (more) items.pop();
    return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
  }
  create(client: string, key: string, input: unknown) {
    return this.#start(client, key, input);
  }
  createDev(context: DevContext, input: unknown) {
    const parsed = TerminalDevSchema.safeParse(input);
    if (!parsed.success)
      return Promise.reject(new FileManagerError("VALIDATION_ERROR", "Invalid terminal program"));
    const turn = getTurnById(this.options.db, context.turnId),
      session = getSessionById(this.options.db, context.sessionId);
    if (
      !turn ||
      !["RUNNING", "PREPARING"].includes(turn.status) ||
      turn.sessionId !== context.sessionId ||
      session?.projectId !== context.projectId
    )
      return Promise.reject(
        new FileManagerError("FORBIDDEN", "Invalid terminal execution context"),
      );
    return this.#start(
      context.clientSessionId,
      createHash("sha256")
        .update(JSON.stringify([context.turnId, context.toolCallId]))
        .digest("hex"),
      {
        scope: { projectId: context.projectId },
        sourceSessionId: context.sessionId,
        cwd: parsed.data.cwd,
        riskAcknowledged: true,
      },
      { context, params: parsed.data },
    );
  }
  #start(
    client: string,
    key: string,
    input: unknown,
    dev?: { context: DevContext; params: ReturnType<typeof TerminalDevSchema.parse> },
  ) {
    const identity = JSON.stringify([client, key]);
    // All same-key callers still validate the final persisted hash below.
    const previous = this.#creating.get(identity);
    const run = (async () => {
      if (previous) await previous;
      return this.#create(client, key, input, dev);
    })();
    this.#creating.set(identity, run);
    void run
      .finally(() => {
        if (this.#creating.get(identity) === run) this.#creating.delete(identity);
      })
      .catch(() => {});
    return run;
  }
  async #create(
    client: string,
    key: string,
    input: unknown,
    dev?: { context: DevContext; params: ReturnType<typeof TerminalDevSchema.parse> },
  ) {
    if (this.#closed || process.platform === "win32")
      fail("RESOURCE_UNAVAILABLE", "Terminal execution unavailable");
    this.#client(client);
    if (!key || key.length > 128) fail("VALIDATION_ERROR", "Idempotency-Key required");
    const parsed = TerminalCreateSchema.safeParse(input);
    if (!parsed.success) fail("VALIDATION_ERROR", "Invalid terminal request");
    const params = parsed.data;
    if (
      params.scope &&
      "projectId" in params.scope &&
      params.scope.projectId === DEFAULT_PROJECT_ID
    )
      params.scope = { workspace: "default" };
    const scope = await this.#scope(params.scope);
    const cwd = scope.scope
      ? await authorizeFileTarget(scope as Awaited<ReturnType<typeof resolveFileScope>>, params.cwd)
      : params.cwd;
    const absolute = await resolveFilePath(scope.root, cwd);
    if (!(await lstat(absolute)).isDirectory())
      fail("VALIDATION_ERROR", "Terminal cwd must be a directory");
    if (params.sourceSessionId) {
      const source = getSessionById(this.options.db, params.sourceSessionId);
      if (
        source?.status !== "active" ||
        !params.scope ||
        ("projectId" in params.scope
          ? source.projectId !== params.scope.projectId
          : "sessionId" in params.scope
            ? source.id !== params.scope.sessionId
            : source.projectId !== null ||
              !isDefaultWorkspace(this.options.dataDir, source.workspacePath))
      )
        fail("FORBIDDEN", "Terminal source does not match scope");
    }
    const shell = await resolveManualShell();
    const executable = dev?.params.executable ?? shell,
      args = dev?.params.args ?? ["-i"];
    const secrets = listEncryptedSecrets(this.options.db).map(
      (secret) =>
        this.options.secretStore?.decrypt(secret) ??
        fail("INTERNAL", "Output protection unavailable"),
    );
    if (
      secrets.some((secret) =>
        [executable, params.cwd, dev?.params.role ?? "", ...args].some((value) =>
          value.includes(secret),
        ),
      )
    )
      fail("FORBIDDEN", "Protected credentials cannot be terminal arguments");
    const launchHash = createHash("sha256")
      .update(JSON.stringify({ executable, args, cwd }))
      .digest("hex");
    const normalized = {
      scope: scope.key,
      cwd,
      sourceSessionId: params.sourceSessionId ?? null,
      executable,
      args,
      role: dev?.params.role ?? null,
      policy: dev?.context.policySnapshotId ?? "human-terminal-v1",
    };
    const hash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
    const existing = findOperation(this.options.db, client, key, "terminal.create");
    if (existing) {
      if (existing.paramsHash !== hash) fail("CONFLICT", "Terminal retry parameters changed");
      const row = allTerminals(this.options.db).find((row) => row.operationId === existing.id);
      if (!row) fail("RESOURCE_UNAVAILABLE", "Terminal result unavailable");
      return this.dto(row);
    }
    if (dev) {
      const active = activeTerminals(this.options.db).find(
        (row) => row.projectId === dev.context.projectId && row.role === dev.params.role,
      );
      if (active) {
        if (active.launchParamsHash !== launchHash)
          fail("CONFLICT", "Terminal role is already active with different parameters");
        dev.context.assertAuthorized();
        return this.dto(active);
      }
    }
    this.#client(client);
    dev?.context.assertAuthorized();
    if (dev?.context.signal?.aborted) fail("RESOURCE_UNAVAILABLE", "Terminal creation cancelled");
    if (
      rootIsQuarantined(scope.root) ||
      pendingOperations(this.options.db).some(
        (op) =>
          isInsideRoot(op.rootRealPath, scope.root) || isInsideRoot(scope.root, op.rootRealPath),
      )
    )
      fail("RESOURCE_LOCKED", "Root requires reconciliation");
    const id = newId("term"),
      operationId = newId("rop"),
      now = this.#now();
    const created = immediateTransaction(this.options.db, (tx) => {
      if (scope.scope)
        assertFileScopeMetadata(
          tx as Database,
          scope as Awaited<ReturnType<typeof resolveFileScope>>,
        );
      insertOperation(tx, {
        id: operationId,
        scopeKey: scope.key,
        rootRealPath: scope.root,
        kind: "terminal.create",
        status: "PREPARED",
        paramsHash: hash,
        idempotencyKey: key,
        clientSessionId: client,
        path: cwd,
        expectedVersion: "",
        targetVersion: "",
        lockId: "",
        fencingToken: 0,
        resultJson: JSON.stringify({ terminalId: id }),
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      });
      const row: TerminalRow = {
        id,
        operationId,
        projectId: params.scope && "projectId" in params.scope ? params.scope.projectId : null,
        workspaceSessionId:
          params.scope && "sessionId" in params.scope && scope.key !== "workspace:default"
            ? params.scope.sessionId
            : null,
        sourceSessionId: params.sourceSessionId ?? null,
        cwd,
        shell,
        mode: dev ? "dev" : "shell",
        role: dev?.params.role ?? null,
        launchParamsJson: dev
          ? JSON.stringify({
              executable: new OutputRedactor([]).push(executable, true),
              args: args.map((arg) => new OutputRedactor([]).push(arg, true)),
              cwd: new OutputRedactor([]).push(cwd, true),
            })
          : null,
        launchParamsHash: launchHash,
        createdByTurnId: dev?.context.turnId ?? null,
        title: null,
        status: "CREATED",
        processIdentityJson: null,
        reasonCode: null,
        outputCursor: 0,
        createdAt: now,
        startedAt: null,
        endedAt: null,
        exitCode: null,
      };
      insertTerminal(tx, row);
      return this.#event(tx, id, "terminal.created", "terminal.created", client);
    });
    this.options.events.publish(created);
    let runtime: Runtime | undefined;
    let spawnAttempted = false;
    try {
      const output = new TerminalOutput(this.options.dataDir, id, this.options.outputLimits);
      const currentScope = await this.#scope(params.scope);
      if (
        currentScope.root !== scope.root ||
        (await resolveFilePath(currentScope.root, cwd)) !== absolute
      )
        throw new Error("Terminal cwd changed");
      this.#client(client);
      dev?.context.assertAuthorized();
      if (this.#closed || dev?.context.signal?.aborted)
        throw new Error("Terminal creation cancelled");
      updateOperation(this.options.db, operationId, { status: "WRITING", updatedAt: this.#now() });
      spawnAttempted = true;
      const launch = terminalLaunch(shell, dev ? { executable, args } : undefined);
      const native = (this.options.spawnPty ?? spawn)(launch.executable, launch.args, {
        cwd: absolute,
        cols: 80,
        rows: 24,
        name: "xterm-256color",
        env: { ...commandEnvironment(), HISTFILE: "/dev/null" },
      });
      const pty = new ManagedPty(native, secrets, (data) => {
        try {
          const chunk = output.append(data, this.#now());
          updateTerminal(this.options.db, id, { outputCursor: chunk.cursor });
          this.options.events.publishTerminalOutput({
            kind: "terminal.output",
            resourceId: id,
            ...chunk,
          });
        } catch {
          if (runtime) runtime.reason = "OUTPUT_FAILED";
          throw new Error("Terminal output unavailable");
        }
      });
      runtime = { pty, output, root: scope.root, operationId, done: Promise.resolve() };
      const active = runtime;
      this.#active.set(id, active);
      const abort = () => {
        active.reason = "CANCELLED_BEFORE_DELIVERY";
        void pty.stop();
      };
      dev?.context.signal?.addEventListener("abort", abort, { once: true });
      active.done = pty.done
        .then((result) => {
          const reason = !result.stopped ? "STOP_UNCONFIRMED" : (active.reason ?? null);
          if (!result.stopped || reason === "OUTPUT_FAILED")
            quarantineRoot(operationId, scope.root);
          this.#status(
            id,
            {
              status:
                !result.stopped || reason === "OUTPUT_FAILED"
                  ? "INTERRUPTED"
                  : active.reason
                    ? "TERMINATED"
                    : "EXITED",
              exitCode: result.exitCode,
              reasonCode: reason,
              endedAt: this.#now(),
              outputCursor: output.cursor,
            },
            "terminal.exit",
            "terminal.finished",
            client,
            (tx) => {
              updateLease(tx, id, { ...CLEARED });
              updateOperation(tx, operationId, {
                status:
                  result.stopped && reason !== "OUTPUT_FAILED"
                    ? "COMPLETED"
                    : "RECONCILIATION_REQUIRED",
                errorCode: reason,
                updatedAt: this.#now(),
              });
            },
          );
          if (result.stopped && reason !== "OUTPUT_FAILED") clearRootQuarantine(operationId);
        })
        .catch(() => {
          quarantineRoot(operationId, scope.root);
          try {
            this.#status(
              id,
              { status: "INTERRUPTED", reasonCode: "RESULT_RECORD_FAILED", endedAt: this.#now() },
              "terminal.status",
              "terminal.failed",
              client,
              (tx) => {
                updateLease(tx, id, { ...CLEARED });
                updateOperation(tx, operationId, {
                  status: "RECONCILIATION_REQUIRED",
                  errorCode: "INTERNAL",
                  updatedAt: this.#now(),
                });
              },
            );
          } catch {
            // Restart reconciliation sees the unfinished terminal even if all DB writes fail.
            updateOperation(this.options.db, operationId, {
              status: "RECONCILIATION_REQUIRED",
              errorCode: "INTERNAL",
              updatedAt: this.#now(),
            });
          }
        })
        .finally(() => {
          this.#active.delete(id);
          dev?.context.signal?.removeEventListener("abort", abort);
        });
      void active.done.catch(() => {});
      await pty.ready;
      if (active.reason) {
        await pty.stop();
        await active.done;
        fail("RESOURCE_UNAVAILABLE", "Terminal output unavailable");
      }
      this.#client(client);
      dev?.context.assertAuthorized();
      if (pty.exited || this.#row(id).endedAt !== null) {
        await active.done;
        return this.read(id);
      }
      if (dev?.context.signal?.aborted || this.#closed) {
        abort();
        await active.done;
        fail("RESOURCE_UNAVAILABLE", "Terminal creation cancelled");
      }
      this.#status(
        id,
        {
          status: "RUNNING",
          startedAt: this.#now(),
          processIdentityJson: JSON.stringify({
            pid: native.pid,
            instance: this.#instance,
            launchId: randomUUID(),
            startedAt: this.#now(),
          }),
        },
        "terminal.status",
        "terminal.started",
        client,
        (tx) => updateOperation(tx, operationId, { status: "COMPLETED", updatedAt: this.#now() }),
      );
      // Successful delivery detaches the resource from the creating Turn.
      const result = await this.read(id);
      if (dev?.context.signal?.aborted) {
        abort();
        await active.done;
        fail("RESOURCE_UNAVAILABLE", "Terminal creation cancelled");
      }
      dev?.context.signal?.removeEventListener("abort", abort);
      return result;
    } catch {
      if (runtime) {
        runtime.reason ??= "START_RECORD_FAILED";
        await runtime.pty.stop();
        await runtime.done;
      } else {
        if (spawnAttempted) quarantineRoot(operationId, scope.root);
        const reasonCode = spawnAttempted ? "SPAWN_UNCONFIRMED" : "NOT_STARTED";
        this.#status(
          id,
          { status: "INTERRUPTED", reasonCode, endedAt: this.#now() },
          "terminal.exit",
          "terminal.failed",
          client,
          (tx) =>
            updateOperation(tx, operationId, {
              status: spawnAttempted ? "RECONCILIATION_REQUIRED" : "FAILED",
              errorCode: reasonCode,
              updatedAt: this.#now(),
            }),
        );
      }
      fail("RESOURCE_UNAVAILABLE", "Terminal could not be started");
    }
  }
  connect(clientId: string, connectionId: string, active: () => boolean) {
    this.#connections.set(connectionId, {
      clientId,
      active,
      subscriptions: new Set(),
      bytes: 0,
      resetAt: this.#now(),
    });
  }
  subscribe(id: string, connectionId: string) {
    const connection = this.#connections.get(connectionId);
    if (!connection?.active()) fail("FORBIDDEN", "Connection is not active");
    connection.subscriptions.add(id);
  }
  unsubscribe(id: string, connectionId: string) {
    const connection = this.#connections.get(connectionId);
    connection?.subscriptions.delete(id);
    this.#releaseConnection(connectionId, id);
  }
  disconnect(connectionId: string) {
    this.#connections.delete(connectionId);
    this.#releaseConnection(connectionId);
  }
  #releaseConnection(connectionId: string, id?: string) {
    for (const row of allTerminals(this.options.db)) {
      const lease = leaseRow(this.options.db, row.id);
      if ((!id || row.id === id) && lease?.ownerConnectionId === connectionId)
        this.#clearLease(row.id);
    }
  }
  #clearLease(id: string) {
    const current = leaseRow(this.options.db, id);
    if (current?.ownerTurnId) this.#agentRate.delete(`${current.ownerTurnId}:${id}`);
    const event = immediateTransaction(this.options.db, (tx) => {
      updateLease(tx, id, { ...CLEARED });
      return this.#event(tx, id, "terminal.lease", "terminal.lease.released");
    });
    this.options.events.publish(event);
  }
  #connection(id: string, client: string, terminalId: string) {
    const connection = this.#connections.get(id);
    if (
      !connection ||
      connection.clientId !== client ||
      !connection.active() ||
      !connection.subscriptions.has(terminalId)
    )
      fail("FORBIDDEN", "Terminal connection does not match client");
    this.#client(client);
    return connection;
  }
  #held(id: string, client: string, connectionId: string, generation?: number): TerminalLeaseRow {
    this.#connection(connectionId, client, id);
    const lease = leaseRow(this.options.db, id);
    if (
      lease?.ownerType !== "human" ||
      lease.ownerClientSessionId !== client ||
      lease.ownerConnectionId !== connectionId ||
      lease.expiresAt <= this.#now() ||
      lease.generation !== generation
    )
      fail("TERMINAL_LEASE_REQUIRED", "Current terminal input lease required");
    if (this.#row(id).status !== "RUNNING" || !this.#active.get(id)?.pty.controlAvailable)
      fail("RESOURCE_UNAVAILABLE", "Terminal is not running");
    return lease;
  }
  async lease(
    id: string,
    client: string,
    input: {
      action: "acquire" | "renew" | "release";
      connectionId: string;
      leaseGeneration?: number;
    },
  ) {
    await this.authorize(id);
    this.#connection(input.connectionId, client, id);
    if (this.#row(id).status !== "RUNNING" || !this.#active.get(id)?.pty.controlAvailable)
      fail("RESOURCE_UNAVAILABLE", "Terminal is not running");
    const event = immediateTransaction(this.options.db, (tx) => {
      const current = leaseRow(tx, id);
      if (!current) throw new Error("Missing terminal lease");
      if (input.action === "acquire") {
        if (
          current.expiresAt > this.#now() &&
          current.ownerType &&
          (current.ownerType === "agent" ||
            (current.ownerConnectionId &&
              this.#connections.get(current.ownerConnectionId)?.active()))
        ) {
          if (
            current.ownerType !== "human" ||
            current.ownerConnectionId !== input.connectionId ||
            current.ownerClientSessionId !== client
          )
            fail("TERMINAL_LEASE_REQUIRED", "Terminal is controlled by another connection");
        } else
          updateLease(tx, id, {
            ownerType: "human",
            ownerClientSessionId: client,
            ownerConnectionId: input.connectionId,
            generation: current.generation + 1,
            expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS,
            heartbeatAt: this.#now(),
            inputSequence: 0,
          });
      } else {
        this.#held(id, client, input.connectionId, input.leaseGeneration);
        updateLease(
          tx,
          id,
          input.action === "release"
            ? { ...CLEARED }
            : { expiresAt: this.#now() + TERMINAL_LEASE_TTL_MS, heartbeatAt: this.#now() },
        );
      }
      return this.#event(tx, id, "terminal.lease", `terminal.lease.${input.action}`, client);
    });
    this.options.events.publish(event);
    return this.read(id);
  }
  expireLeases() {
    for (const row of allTerminals(this.options.db)) {
      const lease = leaseRow(this.options.db, row.id);
      if (
        lease?.ownerType &&
        (lease.expiresAt <= this.#now() ||
          (lease.ownerType === "human"
            ? !lease.ownerConnectionId || !this.#connections.get(lease.ownerConnectionId)?.active()
            : !activeCommandClient(
                this.options.db,
                lease.ownerClientSessionId ?? "",
                this.#now(),
                this.options.idleTtlMinutes,
              )))
      )
        this.#clearLease(row.id);
    }
  }
  async input(
    id: string,
    client: string,
    connectionId: string,
    generation: number,
    sequence: number,
    data: string,
  ) {
    await this.authorize(id);
    const connection = this.#connection(connectionId, client, id);
    if (Buffer.byteLength(data) > 8192) fail("PAYLOAD_TOO_LARGE", "Terminal input exceeds limit");
    if (this.#now() - connection.resetAt >= 1000) {
      connection.bytes = 0;
      connection.resetAt = this.#now();
    }
    if (connection.bytes + Buffer.byteLength(data) > 65536)
      fail("RATE_LIMITED", "Terminal input rate exceeded");
    const accepted = immediateTransaction(this.options.db, (tx) => {
      const lease = this.#held(id, client, connectionId, generation);
      if (sequence <= lease.inputSequence) return false;
      if (sequence !== lease.inputSequence + 1)
        fail("VALIDATION_ERROR", "Terminal input sequence has a gap");
      appendAudit(tx, {
        action: "terminal.input",
        decision: "allow",
        clientSessionId: client,
        resourceType: "terminal",
        resourceId: id,
        details: { bytes: Buffer.byteLength(data), generation, sequence },
        now: this.#now(),
      });
      updateLease(tx, id, { inputSequence: sequence });
      return true;
    });
    if (accepted) {
      connection.bytes += Buffer.byteLength(data);
      try {
        this.#active.get(id)?.pty.native.write(data);
      } catch {
        fail("RESOURCE_UNAVAILABLE", "Terminal input failed");
      }
    }
    return { accepted, inputSequence: sequence };
  }
  async resize(
    id: string,
    client: string,
    input: { connectionId: string; leaseGeneration: number; cols: number; rows: number },
  ) {
    await this.authorize(id);
    this.#held(id, client, input.connectionId, input.leaseGeneration);
    appendAudit(this.options.db, {
      action: "terminal.resize",
      decision: "allow",
      clientSessionId: client,
      resourceType: "terminal",
      resourceId: id,
      details: { cols: input.cols, rows: input.rows },
      now: this.#now(),
    });
    try {
      this.#active.get(id)?.pty.native.resize(input.cols, input.rows);
    } catch {
      fail("RESOURCE_UNAVAILABLE", "Terminal resize failed");
    }
    return this.read(id);
  }
  async output(id: string, after: number, limit: number) {
    const row = await this.authorize(id);
    const writer =
      this.#active.get(id)?.output ??
      new TerminalOutput(this.options.dataDir, id, this.options.outputLimits);
    writer.prune(this.#now());
    const result = writer.read(after, limit, row.outputCursor);
    await this.authorize(id);
    return result;
  }
  async terminate(id: string, client: string) {
    await this.authorize(id);
    this.#client(client);
    const runtime = this.#active.get(id);
    if (runtime) {
      if (!runtime.reason) {
        this.#status(
          id,
          { status: "STOPPING", reasonCode: "TERMINATE_REQUESTED" },
          "terminal.status",
          "terminal.terminate",
          client,
          (tx) => updateLease(tx, id, { ...CLEARED }),
        );
        runtime.reason = "TERMINATE_REQUESTED";
      }
      await runtime.pty.stop();
      await runtime.done;
    }
    return this.read(id);
  }
  async recover() {
    for (const row of activeTerminals(this.options.db)) {
      const operation = findOperationById(this.options.db, row.operationId);
      const safe = operation?.status === "PREPARED" && !row.processIdentityJson;
      this.#status(
        row.id,
        {
          status: "INTERRUPTED",
          reasonCode: safe ? "NOT_STARTED" : "RECOVERY_UNCONFIRMED",
          endedAt: this.#now(),
        },
        "terminal.exit",
        "terminal.interrupted",
        undefined,
        (tx) => {
          updateLease(tx, row.id, { ...CLEARED });
          updateOperation(tx, row.operationId, {
            status: safe ? "FAILED" : "RECONCILIATION_REQUIRED",
            errorCode: safe ? "NOT_STARTED" : "RECOVERY_UNCONFIRMED",
            updatedAt: this.#now(),
          });
        },
      );
    }
    for (const row of allTerminals(this.options.db)) {
      const lease = leaseRow(this.options.db, row.id);
      if (lease?.ownerType) this.#clearLease(row.id);
    }
    await this.cleanup();
  }
  async cleanup() {
    const now = this.#now();
    for (const row of allTerminals(this.options.db))
      new TerminalOutput(this.options.dataDir, row.id, this.options.outputLimits).prune(now);
    for (const row of oldTerminals(this.options.db, now - 30 * 86400000)) {
      const op = findOperationById(this.options.db, row.operationId);
      if (op && ["COMPLETED", "FAILED"].includes(op.status))
        immediateTransaction(this.options.db, (tx) => {
          deleteServicesForTerminal(tx, row.id);
          deleteTerminal(tx, row.id);
          deleteTerminalOperation(tx, row.operationId);
        });
    }
  }
  async close() {
    this.#closed = true;
    clearInterval(this.#timer);
    await Promise.allSettled(
      [...this.#active.values()].map(async (runtime) => {
        runtime.reason = "SERVER_SHUTDOWN";
        await runtime.pty.stop();
        await runtime.done;
      }),
    );
    this.#connections.clear();
  }
}

import { operationRow as findOperationById } from "../commands/repository.js";
import { deleteOperation as deleteTerminalOperation } from "../resources/repository.js";
import { deleteServicesForTerminal } from "../services/repository.js";
