import { NamedServiceIdSchema, ServiceLogsQuerySchema } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { HttpError } from "../errors.js";
import type { NamedServiceManager } from "../modules/services/named.js";

const List = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    sessionId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((value) => !(value.projectId && value.sessionId));

export function registerProcessServiceRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "config">,
  services: NamedServiceManager,
): void {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const id = (request: FastifyRequest) => {
    const parsed = z.object({ id: NamedServiceIdSchema }).safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service ID");
    return parsed.data.id;
  };
  app.get("/api/process-services", (request) => {
    client(request);
    const parsed = List.safeParse(request.query);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service query");
    return { items: services.list(parsed.data) };
  });
  app.get("/api/process-services/:id", (request) => {
    client(request);
    return services.get(id(request));
  });
  app.get("/api/process-services/:id/logs", async (request) => {
    const clientSessionId = client(request);
    const parsed = ServiceLogsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid service log query");
    const service = services.get(id(request));
    return services.logs(
      service.id,
      {
        sessionId: service.sessionId,
        clientSessionId,
        projectId: service.projectId,
      },
      parsed.data.after,
      parsed.data.limit,
    );
  });
  app.post("/api/process-services/:id/stop", async (request) => {
    const clientSessionId = client(request);
    const service = services.get(id(request));
    return services.stop(service.id, {
      sessionId: service.sessionId,
      clientSessionId,
      projectId: service.projectId,
    });
  });
}
