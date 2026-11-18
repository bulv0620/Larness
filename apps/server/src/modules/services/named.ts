import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { FileManagerError } from "@larness/resources";
import {
  type NamedServiceDto,
  type NamedServiceStatus,
  type ProcessOutputPage,
  StartServiceParamsSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import type { ProcessContext, ProcessManager } from "../processes/manager.js";

export interface NamedServiceEvent {
  type: "service.started" | "service.stopped";
  sessionId: string;
  turnId: string;
  payload: Record<string, unknown>;
}

export interface NamedServiceManagerOptions {
  db: Database;
  processes: ProcessManager;
  onEvent?: (event: NamedServiceEvent) => void;
  now?: () => number;
  healthTimeoutMs?: number;
}

interface NamedService {
  id: string;
  projectId: string;
  sessionId: string;
  turnId: string;
  processId: string;
  name: string;
  executable: string;
  args: string[];
  cwd: string;
  port: number;
  status: NamedServiceStatus;
  reasonCode: string | null;
  createdAt: number;
  updatedAt: number;
  endedAt: number | null;
  commandHash: string;
}

function fail(code: ConstructorParameters<typeof FileManagerError>[0], message: string): never {
  throw new FileManagerError(code, message);
}

function commandHash(executable: string, args: string[], cwd: string): string {
  return createHash("sha256").update(JSON.stringify({ executable, args, cwd })).digest("hex");
}

async function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export class NamedServiceManager {
  readonly #services = new Map<string, NamedService>();
  readonly #options: NamedServiceManagerOptions;

  constructor(options: NamedServiceManagerOptions) {
    this.#options = options;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  #dto(service: NamedService): NamedServiceDto {
    return {
      id: service.id,
      projectId: service.projectId,
      sessionId: service.sessionId,
      processId: service.processId,
      name: service.name,
      executable: service.executable,
      cwd: service.cwd,
      port: service.port,
      status: service.status,
      previewEligible: false,
      reasonCode: service.reasonCode,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
      endedAt: service.endedAt,
    };
  }

  #refresh(service: NamedService): NamedService {
    const process = this.#options.processes.get(service.processId);
    if (service.status === "RUNNING" && ["EXITED", "FAILED", "STOPPED"].includes(process.status)) {
      service.status = process.status === "STOPPED" ? "STOPPED" : "FAILED";
      service.reasonCode = process.reasonCode ?? (process.status === "EXITED" ? "EXITED" : null);
      service.endedAt = process.endedAt ?? this.#now();
      service.updatedAt = this.#now();
    }
    return service;
  }

  #emit(service: NamedService, type: NamedServiceEvent["type"]): void {
    try {
      this.#options.onEvent?.({
        type,
        sessionId: service.sessionId,
        turnId: service.turnId,
        payload: {
          serviceId: service.id,
          processId: service.processId,
          name: service.name,
          status: service.status,
          port: service.port,
        },
      });
    } catch {
      // Lifecycle persistence is handled by the caller; a dropped event must
      // not make a running service disappear.
    }
  }

  async #health(port: number, healthPath: string | undefined): Promise<boolean> {
    if (healthPath === undefined) return true;
    const deadline = Date.now() + (this.#options.healthTimeoutMs ?? 5_000);
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}${healthPath}`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) return true;
      } catch {
        /* Retry until the deadline. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  async start(context: ProcessContext, input: unknown): Promise<NamedServiceDto> {
    const parsed = StartServiceParamsSchema.safeParse(input);
    if (!parsed.success) fail("VALIDATION_ERROR", "Invalid service request");
    const params = parsed.data;
    const processes = this.#options.processes;
    const projectId = context.projectId;
    if (projectId === undefined || projectId === null) {
      fail("FORBIDDEN", "A project is required to start a named service");
    }
    const hash = commandHash(params.executable, params.args, params.cwd);
    const existing = [...this.#services.values()].find(
      (service) =>
        service.projectId === projectId &&
        service.name === params.name &&
        service.status === "RUNNING",
    );
    if (existing !== undefined) {
      if (existing.commandHash !== hash) {
        fail("CONFLICT", "A service with this name already uses different parameters");
      }
      return this.#dto(this.#refresh(existing));
    }
    if (!(await portAvailable(params.port))) {
      fail("CONFLICT", "The requested service port is already in use");
    }

    const process = await processes.start(context, {
      executable: params.executable,
      args: params.args,
      cwd: params.cwd,
      name: params.name,
    });
    const service: NamedService = {
      id: newId("svc"),
      projectId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      processId: process.id,
      name: params.name,
      executable: params.executable,
      args: params.args,
      cwd: process.cwd,
      port: params.port,
      status: process.status === "RUNNING" ? "RUNNING" : "FAILED",
      reasonCode: process.reasonCode,
      createdAt: this.#now(),
      updatedAt: this.#now(),
      endedAt: process.endedAt,
      commandHash: hash,
    };
    this.#services.set(service.id, service);

    if (service.status !== "RUNNING") {
      this.#emit(service, "service.stopped");
      return this.#dto(service);
    }
    if (!(await this.#health(params.port, params.healthPath))) {
      service.status = "FAILED";
      service.reasonCode = "HEALTH_CHECK_FAILED";
      service.endedAt = this.#now();
      service.updatedAt = this.#now();
      await this.#options.processes.stop(process.id, {
        sessionId: context.sessionId,
        projectId,
      });
      this.#emit(service, "service.stopped");
      fail("RESOURCE_UNAVAILABLE", "Service health check failed");
    }
    this.#emit(service, "service.started");
    return this.#dto(service);
  }

  list(filter: { projectId?: string; sessionId?: string } = {}): NamedServiceDto[] {
    return [...this.#services.values()]
      .map((service) => this.#refresh(service))
      .filter(
        (service) =>
          (filter.projectId === undefined || service.projectId === filter.projectId) &&
          (filter.sessionId === undefined || service.sessionId === filter.sessionId),
      )
      .map((service) => this.#dto(service));
  }

  get(id: string): NamedServiceDto {
    const service = this.#services.get(id);
    if (service === undefined) fail("NOT_FOUND", "Service not found");
    return this.#dto(this.#refresh(service));
  }

  async logs(
    id: string,
    context: Pick<ProcessContext, "sessionId" | "clientSessionId"> & { projectId?: string | null },
    after: number,
    limit: number,
  ): Promise<ProcessOutputPage> {
    const service = this.#services.get(id);
    if (service === undefined) fail("NOT_FOUND", "Service not found");
    return this.#options.processes.readOutput(service.processId, context, after, limit);
  }

  async stop(
    id: string,
    context: Pick<ProcessContext, "sessionId" | "clientSessionId"> & { projectId?: string | null },
  ): Promise<{ service: NamedServiceDto; stopped: boolean }> {
    const service = this.#services.get(id);
    if (service === undefined) fail("NOT_FOUND", "Service not found");
    if (service.status === "STOPPED" || service.status === "FAILED") {
      return { service: this.#dto(service), stopped: true };
    }
    const result = await this.#options.processes.stop(service.processId, context);
    service.status = result.stopped ? "STOPPED" : "FAILED";
    service.reasonCode = result.stopped ? null : "STOP_UNCONFIRMED";
    service.endedAt = this.#now();
    service.updatedAt = this.#now();
    this.#emit(service, "service.stopped");
    return { service: this.#dto(service), stopped: result.stopped };
  }

  async close(): Promise<void> {
    this.#services.clear();
  }
}
