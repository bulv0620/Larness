import { createHash } from "node:crypto";
import { FileManagerError } from "@larness/resources";
import {
  type ServiceDto,
  type ServiceRegisterInput,
  ServiceRegisterInputSchema,
  ServiceStatusSchema,
} from "@larness/shared";
import { eq } from "drizzle-orm";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import {
  type ResourceActionRow,
  resourceActions,
  type ServiceRow,
  type TerminalRow,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getProjectById } from "../projects/repository.js";
import type { ResourceEventBus } from "../resources/events.js";
import {
  appendResourceEvent,
  findOperation,
  insertOperation,
  updateOperation,
} from "../resources/repository.js";
import { terminalRow } from "../terminals/repository.js";
import {
  type ExecutionIdentity,
  parseExecutionIdentity,
  probeExecution,
  ServiceIdentityError,
  verifyExecution,
} from "./identity.js";
import {
  activeServiceAt,
  activeServices,
  decodeServiceCursor,
  encodeServiceCursor,
  insertService,
  isActiveServiceStatus,
  listServices,
  serviceByOperation,
  serviceDto,
  serviceRow,
  updateService,
} from "./repository.js";

export interface ServiceManagerOptions {
  db: import("../../db/client.js").Database;
  events: ResourceEventBus;
  now?: () => number;
}

export interface RegisterServiceInput extends ServiceRegisterInput {
  projectId: string;
  operationId: string;
  sourceSessionId?: string;
}

function isUniqueConstraint(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}

function terminalProcess(terminal: TerminalRow): { pid: number; launchId: string } {
  let value: unknown;
  try {
    value = JSON.parse(terminal.processIdentityJson ?? "{}");
  } catch {
    value = {};
  }
  const parsed = value as { pid?: unknown; launchId?: unknown };
  if (typeof parsed.pid !== "number") {
    throw new FileManagerError(
      "RESOURCE_UNAVAILABLE",
      "Terminal execution identity is unavailable",
    );
  }
  return { pid: parsed.pid, launchId: typeof parsed.launchId === "string" ? parsed.launchId : "" };
}

const ACTION_TTL_MS = 5 * 60_000;

export interface ServiceActionView {
  id: string;
  projectId: string;
  kind: "service.register";
  risk: "L2";
  status: ResourceActionRow["status"];
  params: ServiceRegisterInput;
  paramsHash: string;
  snapshotVersion: string;
  requestedBy: string;
  decidedBy: string | null;
  expiresAt: number;
  decidedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  result: unknown;
  createdAt: number;
}

function registrationSnapshot(terminal: TerminalRow, data: ServiceRegisterInput): string {
  const process = terminalProcess(terminal);
  return createHash("sha256")
    .update(
      JSON.stringify({
        terminalId: terminal.id,
        launchId: process.launchId,
        pid: process.pid,
        endpoint: data.endpoint,
      }),
    )
    .digest("hex");
}

function identityFailure(error: unknown): never {
  if (error instanceof ServiceIdentityError) {
    throw new FileManagerError("PREVIEW_TARGET_INVALID", error.message);
  }
  throw error;
}

export class ServiceManager {
  readonly #db: import("../../db/client.js").Database;
  readonly #events: ResourceEventBus;
  readonly #now: () => number;
  #reconciling = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(options: ServiceManagerOptions) {
    this.#db = options.db;
    this.#events = options.events;
    this.#now = options.now ?? Date.now;
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      void this.reconcile().catch(() => undefined);
    }, 1000);
    this.#timer.unref();
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = undefined;
  }

  dto(row: ServiceRow): ServiceDto {
    return serviceDto(row);
  }

  get(id: string): ServiceDto {
    const row = serviceRow(this.#db, id);
    if (!row) throw new FileManagerError("NOT_FOUND", "Service not found");
    return serviceDto(row);
  }

  list(input: { projectId: string; status?: string; limit: number; cursor?: string }) {
    const status = input.status ? ServiceStatusSchema.safeParse(input.status) : null;
    if (status && !status.success) {
      throw new FileManagerError("VALIDATION_ERROR", "Invalid service status");
    }
    const cursor = input.cursor ? decodeServiceCursor(input.cursor) : null;
    if (input.cursor && !cursor) {
      throw new FileManagerError("VALIDATION_ERROR", "Invalid service cursor");
    }
    const rows = listServices(this.#db, {
      projectId: input.projectId,
      status: status?.success ? status.data : undefined,
      limit: input.limit,
      ...(cursor ? { cursor } : {}),
    });
    const last = rows.at(-1);
    return {
      items: rows.map(serviceDto),
      nextCursor: rows.length === input.limit && last ? encodeServiceCursor(last) : null,
    };
  }

  async registerAgent(
    input: ServiceRegisterInput & {
      projectId: string;
      operationKey: string;
      sourceSessionId?: string;
    },
    client: string,
  ): Promise<ServiceDto> {
    const parsed = ServiceRegisterInputSchema.safeParse({
      kind: input.kind,
      terminalId: input.terminalId,
      name: input.name,
      endpoint: input.endpoint,
    });
    if (!parsed.success) {
      throw new FileManagerError("VALIDATION_ERROR", "Invalid service registration");
    }
    const data = parsed.data;
    const existing = findOperation(this.#db, client, input.operationKey, "service.register");
    if (existing) {
      const service = serviceByOperation(this.#db, existing.id);
      if (service) return serviceDto(service);
    }
    const project = getProjectById(this.#db, input.projectId);
    if (!project) throw new FileManagerError("NOT_FOUND", "Project not found");
    const operationId = existing?.id ?? newId("rop");
    const now = this.#now();
    const paramsJson = JSON.stringify(data);
    if (!existing) {
      insertOperation(this.#db, {
        id: operationId,
        scopeKey: `project:${input.projectId}`,
        rootRealPath: project.realPath,
        kind: "service.register",
        status: "PREPARED",
        paramsHash: createHash("sha256").update(paramsJson).digest("hex"),
        idempotencyKey: input.operationKey,
        clientSessionId: client,
        path: "",
        expectedVersion: "",
        targetVersion: "",
        lockId: "",
        fencingToken: 0,
        resultJson: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    try {
      const service = await this.register(
        {
          ...data,
          projectId: input.projectId,
          operationId,
          ...(input.sourceSessionId === undefined
            ? {}
            : { sourceSessionId: input.sourceSessionId }),
        },
        client,
      );
      updateOperation(this.#db, operationId, {
        status: "COMPLETED",
        resultJson: JSON.stringify({ serviceId: service.id }),
        updatedAt: this.#now(),
      });
      return service;
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      updateOperation(this.#db, operationId, {
        status: "FAILED",
        errorCode: typeof code === "string" ? code : "INTERNAL",
        updatedAt: this.#now(),
      });
      throw error;
    }
  }

  async register(input: RegisterServiceInput, client: string): Promise<ServiceDto> {
    const parsed = ServiceRegisterInputSchema.safeParse({
      kind: input.kind,
      terminalId: input.terminalId,
      name: input.name,
      endpoint: input.endpoint,
    });
    if (!parsed.success) {
      throw new FileManagerError("VALIDATION_ERROR", "Invalid service registration");
    }
    const data = parsed.data;
    const operation = serviceByOperation(this.#db, input.operationId);
    if (operation) return serviceDto(operation);

    const terminal = terminalRow(this.#db, data.terminalId);
    if (!terminal || terminal.projectId !== input.projectId) {
      throw new FileManagerError("NOT_FOUND", "Terminal not found for this project");
    }
    if (terminal.status !== "RUNNING") {
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Terminal is not running");
    }
    const active = activeServiceAt(this.#db, terminal.id, data.endpoint.host, data.endpoint.port);
    if (active) {
      if (active.name !== data.name) {
        throw new FileManagerError("CONFLICT", "This endpoint is already registered");
      }
      return serviceDto(active);
    }

    const process = terminalProcess(terminal);
    const probe = await probeExecution({ leaderPid: process.pid, port: data.endpoint.port }).catch(
      identityFailure,
    );
    const now = this.#now();
    const row: ServiceRow = {
      id: newId("svc"),
      operationId: input.operationId,
      projectId: input.projectId,
      sourceSessionId: input.sourceSessionId ?? null,
      terminalId: terminal.id,
      name: data.name,
      kind: data.kind,
      status: "RUNNING",
      terminalExecutionId: newId("exe"),
      endpointGeneration: 1,
      endpointHost: data.endpoint.host,
      endpointPort: data.endpoint.port,
      endpointProtocol: data.endpoint.protocol,
      identityJson: JSON.stringify({ ...probe, launchId: process.launchId }),
      reasonCode: null,
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    };
    try {
      const event = immediateTransaction(this.#db, (tx) => {
        insertService(tx, row);
        appendAudit(tx, {
          action: "service.register",
          decision: "allow",
          clientSessionId: client,
          sessionId: input.sourceSessionId,
          resourceType: "service",
          resourceId: row.id,
          details: {
            projectId: row.projectId,
            terminalId: row.terminalId,
            endpoint: { host: row.endpointHost, port: row.endpointPort },
            status: row.status,
          },
          now,
        });
        return appendResourceEvent(tx, row.id, "service.registered", this.#payload(row), now);
      });
      this.#events.publish(event);
      return serviceDto(row);
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      const existing = serviceByOperation(this.#db, input.operationId);
      if (existing) return serviceDto(existing);
      const raced = activeServiceAt(this.#db, terminal.id, data.endpoint.host, data.endpoint.port);
      if (raced?.name === data.name) return serviceDto(raced);
      throw new FileManagerError("CONFLICT", "This endpoint is already registered");
    }
  }

  action(id: string): ServiceActionView {
    return this.#actionView(this.#actionRow(id));
  }

  createAction(projectId: string, input: unknown, requestedBy: string): ServiceActionView {
    const parsed = ServiceRegisterInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new FileManagerError("VALIDATION_ERROR", "Invalid service registration");
    }
    const data = parsed.data;
    const project = getProjectById(this.#db, projectId);
    if (!project) throw new FileManagerError("NOT_FOUND", "Project not found");
    const terminal = terminalRow(this.#db, data.terminalId);
    if (!terminal || terminal.projectId !== project.id) {
      throw new FileManagerError("NOT_FOUND", "Terminal not found for this project");
    }
    if (terminal.status !== "RUNNING") {
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Terminal is not running");
    }
    const now = this.#now();
    const id = newId("act");
    const operationId = newId("rop");
    const paramsJson = JSON.stringify(data);
    const paramsHash = createHash("sha256").update(paramsJson).digest("hex");
    const snapshot = registrationSnapshot(terminal, data);
    immediateTransaction(this.#db, (tx) => {
      insertOperation(tx, {
        id: operationId,
        scopeKey: `project:${project.id}`,
        rootRealPath: project.realPath,
        kind: "service.register",
        status: "PREPARED",
        paramsHash,
        idempotencyKey: id,
        clientSessionId: requestedBy,
        path: "",
        expectedVersion: "",
        targetVersion: "",
        lockId: "",
        fencingToken: 0,
        resultJson: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      });
      tx.insert(resourceActions)
        .values({
          id,
          operationId,
          projectId: project.id,
          kind: "service.register",
          risk: "L2",
          status: "WAITING_APPROVAL",
          paramsJson,
          paramsHash,
          snapshotHash: snapshot,
          requestedBy,
          decidedBy: null,
          expiresAt: now + ACTION_TTL_MS,
          decidedAt: null,
          startedAt: null,
          endedAt: null,
          resultJson: null,
          createdAt: now,
        })
        .run();
      appendAudit(tx, {
        action: "service.action.created",
        decision: "info",
        clientSessionId: requestedBy,
        resourceType: "service",
        resourceId: id,
        details: {
          projectId: project.id,
          terminalId: data.terminalId,
          endpoint: data.endpoint,
          kind: "service.register",
          risk: "L2",
        },
        now,
      });
    });
    return this.action(id);
  }

  decideAction(id: string, decision: "approve" | "reject", decidedBy: string): ServiceActionView {
    const row = immediateTransaction(this.#db, (tx) => {
      const current = tx.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
      if (current?.kind !== "service.register") {
        throw new FileManagerError("NOT_FOUND", "Service action not found");
      }
      if (current.status !== "WAITING_APPROVAL") {
        throw new FileManagerError("APPROVAL_INVALID", "Service action is not pending");
      }
      const now = this.#now();
      if (current.expiresAt <= now) {
        tx.update(resourceActions)
          .set({ status: "EXPIRED", endedAt: now })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, current.operationId, {
          status: "FAILED",
          errorCode: "EXPIRED",
          updatedAt: now,
        });
        return tx.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
      }
      const status = decision === "approve" ? "APPROVED" : "REJECTED";
      tx.update(resourceActions)
        .set({
          status,
          decidedBy,
          decidedAt: now,
          endedAt: decision === "reject" ? now : null,
        })
        .where(eq(resourceActions.id, id))
        .run();
      if (decision === "reject") {
        updateOperation(tx, current.operationId, {
          status: "FAILED",
          errorCode: "REJECTED",
          updatedAt: now,
        });
      }
      appendAudit(tx, {
        action: decision === "approve" ? "service.action.approved" : "service.action.rejected",
        decision: decision === "approve" ? "allow" : "deny",
        clientSessionId: decidedBy,
        resourceType: "service",
        resourceId: id,
        details: { kind: current.kind, risk: current.risk },
        now,
      });
      return tx.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
    });
    if (!row) throw new FileManagerError("NOT_FOUND", "Service action not found");
    if (row.status === "EXPIRED") {
      throw new FileManagerError("APPROVAL_INVALID", "Service action expired");
    }
    return this.#actionView(row);
  }

  async executeAction(id: string, client: string): Promise<ServiceActionView> {
    const row = this.#actionRow(id);
    if (["COMPLETED", "FAILED", "REJECTED", "EXPIRED", "INTERRUPTED"].includes(row.status)) {
      return this.#actionView(row);
    }
    if (row.status !== "APPROVED") {
      throw new FileManagerError("APPROVAL_INVALID", "Service action is not approved");
    }
    if (row.expiresAt <= this.#now()) {
      this.#failAction(id, row.operationId, "EXPIRED", "EXPIRED");
      throw new FileManagerError("APPROVAL_INVALID", "Service action expired");
    }
    const data = ServiceRegisterInputSchema.parse(JSON.parse(row.paramsJson));
    const terminal = terminalRow(this.#db, data.terminalId);
    if (!terminal || terminal.projectId !== row.projectId || terminal.status !== "RUNNING") {
      this.#failAction(id, row.operationId, "FAILED", "RESOURCE_UNAVAILABLE");
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Terminal is unavailable");
    }
    if (registrationSnapshot(terminal, data) !== row.snapshotHash) {
      this.#failAction(id, row.operationId, "FAILED", "CONFLICT");
      throw new FileManagerError("CONFLICT", "Terminal changed after registration was prepared");
    }
    try {
      const service = await this.register(
        {
          ...data,
          projectId: row.projectId,
          operationId: row.operationId,
        },
        client,
      );
      const now = this.#now();
      immediateTransaction(this.#db, (tx) => {
        tx.update(resourceActions)
          .set({
            status: "COMPLETED",
            startedAt: now,
            endedAt: now,
            resultJson: JSON.stringify({ serviceId: service.id }),
          })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, row.operationId, {
          status: "COMPLETED",
          resultJson: JSON.stringify({ serviceId: service.id }),
          updatedAt: now,
        });
        appendAudit(tx, {
          action: "service.action.completed",
          decision: "allow",
          clientSessionId: client,
          resourceType: "service",
          resourceId: id,
          details: { projectId: row.projectId, serviceId: service.id },
          now,
        });
      });
      return this.action(id);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      this.#failAction(id, row.operationId, "FAILED", typeof code === "string" ? code : "INTERNAL");
      throw error;
    }
  }

  #failAction(id: string, operationId: string, status: "FAILED" | "EXPIRED", errorCode: string) {
    const now = this.#now();
    immediateTransaction(this.#db, (tx) => {
      tx.update(resourceActions)
        .set({ status, endedAt: now })
        .where(eq(resourceActions.id, id))
        .run();
      updateOperation(tx, operationId, { status: "FAILED", errorCode, updatedAt: now });
    });
  }

  #actionRow(id: string): ResourceActionRow {
    const row = this.#db.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
    if (row?.kind !== "service.register") {
      throw new FileManagerError("NOT_FOUND", "Service action not found");
    }
    return row;
  }

  #actionView(row: ResourceActionRow): ServiceActionView {
    return {
      id: row.id,
      projectId: row.projectId,
      kind: "service.register",
      risk: "L2",
      status: row.status,
      params: ServiceRegisterInputSchema.parse(JSON.parse(row.paramsJson)),
      paramsHash: row.paramsHash,
      snapshotVersion: row.snapshotHash,
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      result: row.resultJson ? JSON.parse(row.resultJson) : null,
      createdAt: row.createdAt,
    };
  }

  unregister(id: string, reasonCode: string, client?: string): ServiceDto | null {
    const now = this.#now();
    const event = immediateTransaction(this.#db, (tx) => {
      const row = serviceRow(tx, id);
      if (!row || !isActiveServiceStatus(row.status)) return null;
      updateService(tx, id, {
        status: "UNREGISTERED",
        reasonCode,
        endedAt: now,
        updatedAt: now,
      });
      appendAudit(tx, {
        action: "service.unregister",
        decision: "info",
        clientSessionId: client,
        resourceType: "service",
        resourceId: id,
        details: {
          projectId: row.projectId,
          terminalId: row.terminalId,
          status: "UNREGISTERED",
          reasonCode,
        },
        now,
      });
      const changed = serviceRow(tx, id);
      if (!changed) throw new Error("Service disappeared during unregistration");
      return appendResourceEvent(tx, id, "service.unregistered", this.#payload(changed), now);
    });
    if (!event) return null;
    this.#events.publish(event);
    return this.get(id);
  }

  async reconcile(): Promise<void> {
    if (this.#reconciling) return;
    this.#reconciling = true;
    try {
      for (const row of activeServices(this.#db)) {
        const terminal = terminalRow(this.#db, row.terminalId);
        if (terminal?.status !== "RUNNING") {
          this.unregister(row.id, "TERMINAL_ENDED");
          continue;
        }
        try {
          const identity: ExecutionIdentity = parseExecutionIdentity(row.identityJson);
          await verifyExecution(identity);
        } catch (error) {
          const reason = error instanceof ServiceIdentityError ? error.reason : "ENDPOINT_LOST";
          this.unregister(row.id, reason);
        }
      }
    } finally {
      this.#reconciling = false;
    }
  }

  #payload(row: ServiceRow) {
    return {
      status: row.status,
      terminalId: row.terminalId,
      terminalExecutionId: row.terminalExecutionId,
      endpointGeneration: row.endpointGeneration,
      reasonCode: row.reasonCode,
    };
  }
}
