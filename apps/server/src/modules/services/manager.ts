import { FileManagerError } from "@larness/resources";
import {
  type ServiceDto,
  type ServiceRegisterInput,
  ServiceRegisterInputSchema,
  ServiceStatusSchema,
} from "@larness/shared";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ServiceRow, TerminalRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { ResourceEventBus } from "../resources/events.js";
import { appendResourceEvent } from "../resources/repository.js";
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

  constructor(options: ServiceManagerOptions) {
    this.#db = options.db;
    this.#events = options.events;
    this.#now = options.now ?? Date.now;
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
