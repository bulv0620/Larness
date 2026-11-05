import { FileManagerError } from "@larness/resources";
import { ServiceRegisterInputSchema, ServiceStatusSchema } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import type { ServiceManager } from "../modules/services/manager.js";
import { terminalRow } from "../modules/terminals/repository.js";

const Params = z.object({ id: z.string().min(1).max(128) }).strict();
const ListQuery = z
  .object({
    projectId: z.string().min(1).max(128),
    status: ServiceStatusSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
const LogsQuery = z
  .object({
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export function registerServiceRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "config" | "terminals">,
  services: ServiceManager,
): void {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const serviceId = (request: FastifyRequest) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service ID");
    return parsed.data.id;
  };
  async function run<T>(request: FastifyRequest, action: () => T | Promise<T>): Promise<T> {
    try {
      client(request);
      const result = await action();
      client(request);
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof FileManagerError) {
        try {
          appendAudit(deps.db, {
            action: "service.denied",
            decision: "deny",
            clientSessionId: request.clientSession?.id,
            resourceType: "service",
            details: { code: error.code, requestId: request.id },
          });
        } catch {
          throw new HttpError("INTERNAL", "Service audit unavailable");
        }
        throw new HttpError(error.code, error.message);
      }
      throw new HttpError("INTERNAL", "Service operation failed");
    }
  }
  app.get("/api/services", (request) =>
    run(request, () => {
      const parsed = ListQuery.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service query");
      return services.list(parsed.data);
    }),
  );
  app.get("/api/services/:id", (request) =>
    run(request, () => {
      const dto = services.get(serviceId(request));
      if (!dto.projectId) throw new HttpError("NOT_FOUND", "Service not found");
      return dto;
    }),
  );
  app.get("/api/services/:id/logs", (request) =>
    run(request, async () => {
      const parsed = LogsQuery.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service log query");
      const dto = services.get(serviceId(request));
      if (!deps.terminals) throw new HttpError("RESOURCE_UNAVAILABLE", "Terminal is unavailable");
      const output = await deps.terminals.output(
        dto.terminalId,
        parsed.data.after,
        parsed.data.limit,
      );
      return { terminalId: dto.terminalId, ...output };
    }),
  );
  app.delete("/api/services/:id", (request) =>
    run(request, () => {
      const dto = services.remove(serviceId(request), client(request));
      return dto;
    }),
  );
  app.post("/api/services/:id/stop", (request) =>
    run(request, () => services.stopService(serviceId(request), client(request))),
  );
  app.post("/api/services", async (request, reply) => {
    const result = await run(request, async () => {
      const parsed = ServiceRegisterInputSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service registration");
      const terminal = terminalRow(deps.db, parsed.data.terminalId);
      if (!terminal?.projectId)
        throw new HttpError("NOT_FOUND", "Terminal not found for a project");
      return services.createAction(terminal.projectId, parsed.data, client(request));
    });
    return reply.code(201).send(result);
  });
}
