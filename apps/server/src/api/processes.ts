import { ProcessIdSchema, ProcessOutputQuerySchema } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import type { ProcessManager } from "../modules/processes/manager.js";

const List = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    sessionId: z.string().min(1).max(128).optional(),
  })
  .strict()
  .refine((value) => !(value.projectId && value.sessionId));

export function registerProcessRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "config">,
  processes: ProcessManager,
): void {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const id = (request: FastifyRequest) => {
    const parsed = z.object({ id: ProcessIdSchema }).safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid process ID");
    return parsed.data.id;
  };
  async function run(request: FastifyRequest, action: () => Promise<unknown>) {
    try {
      client(request);
      const result = await action();
      client(request);
      return result;
    } catch (error) {
      const failure =
        error instanceof HttpError
          ? error
          : new HttpError(
              typeof (error as { code?: unknown })?.code === "string"
                ? ((error as { code: string }).code as never)
                : "INTERNAL",
              error instanceof Error ? error.message : "Process operation failed",
            );
      try {
        appendAudit(deps.db, {
          action: "process.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "process",
          details: { code: failure.code, requestId: request.id },
        });
      } catch {
        throw new HttpError("INTERNAL", "Process audit unavailable");
      }
      throw new HttpError(failure.code, failure.message);
    }
  }
  app.get("/api/processes", (request) =>
    run(request, async () => {
      const parsed = List.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid process query");
      return { items: processes.list(parsed.data) };
    }),
  );
  app.get("/api/processes/:id", (request) => run(request, async () => processes.get(id(request))));
  app.get("/api/processes/:id/output", (request) =>
    run(request, async () => {
      const parsed = ProcessOutputQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid process output query");
      const process = processes.get(id(request));
      return processes.readOutput(
        process.id,
        {
          sessionId: process.sessionId,
          projectId: process.projectId,
          clientSessionId: client(request),
        },
        parsed.data.after,
        parsed.data.limit,
      );
    }),
  );
  app.post("/api/processes/:id/stop", (request) =>
    run(request, async () => {
      const process = processes.get(id(request));
      return processes.stop(process.id, {
        sessionId: process.sessionId,
        projectId: process.projectId,
        clientSessionId: client(request),
      });
    }),
  );
}
