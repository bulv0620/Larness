import { FileManagerError } from "@larness/resources";
import { GitActionDecisionSchema } from "@larness/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { resourceActions } from "../db/schema.js";
import { HttpError } from "../errors.js";
import type { GitManager } from "../modules/git/manager.js";
import type { ServiceManager } from "../modules/services/manager.js";

const Params = z.object({ id: z.string().min(1).max(128) }).strict();

export function registerResourceActionRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "config">,
  managers: { git: GitManager; services: ServiceManager },
): void {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const actionId = (request: FastifyRequest) => {
    const parsed = Params.safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid action ID");
    return parsed.data.id;
  };
  const row = (id: string) => {
    const value = deps.db.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
    if (!value) throw new HttpError("NOT_FOUND", "Resource action not found");
    return value;
  };
  const dispatch = (id: string, git: () => unknown, service: () => unknown): unknown => {
    const current = row(id);
    if (current.kind === "service.register") return service();
    return git();
  };
  async function run(request: FastifyRequest, action: () => unknown | Promise<unknown>) {
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
            action: "resource.action.denied",
            decision: "deny",
            clientSessionId: request.clientSession?.id,
            details: { code: error.code, requestId: request.id },
          });
        } catch {
          throw new HttpError("INTERNAL", "Resource action audit unavailable");
        }
        throw new HttpError(error.code, error.message);
      }
      throw new HttpError("INTERNAL", "Resource action failed");
    }
  }
  app.get("/api/resource-actions/:id", (request) =>
    run(request, () => {
      const id = actionId(request);
      return dispatch(
        id,
        () => managers.git.action(id),
        () => managers.services.action(id),
      );
    }),
  );
  app.post("/api/resource-actions/:id/decision", (request) =>
    run(request, () => {
      const parsed = GitActionDecisionSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid action decision");
      const id = actionId(request);
      return dispatch(
        id,
        () => managers.git.decideAction(id, parsed.data.decision, client(request)),
        () => managers.services.decideAction(id, parsed.data.decision, client(request)),
      );
    }),
  );
  app.post("/api/resource-actions/:id/execute", (request) =>
    run(request, async () => {
      const body = request.body as unknown;
      if (
        body !== undefined &&
        body !== null &&
        (typeof body !== "object" || Object.keys(body).length > 0)
      )
        throw new HttpError("VALIDATION_ERROR", "Resource execution takes no parameters");
      const id = actionId(request);
      const current = row(id);
      return current.kind === "service.register"
        ? managers.services.executeAction(id, client(request))
        : managers.git.executeAction(id, client(request));
    }),
  );
}
