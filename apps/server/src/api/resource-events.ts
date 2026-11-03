import { FileManagerError } from "@larness/resources";
import { ResourceEventsQuerySchema } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../app.js";
import { resolveActiveSession } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import { knownCredentialGuard } from "../modules/files/credentials.js";
import { listResourceEvents } from "../modules/resources/events.js";

export function registerResourceEventRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "dataDir" | "config" | "secretStore">,
) {
  app.get("/api/resource-events", async (request) => {
    const parsed = ResourceEventsQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid resource event query");
    try {
      const result = await listResourceEvents(deps, parsed.data);
      const guard = knownCredentialGuard(deps.db, deps.secretStore);
      for (const item of result.items) {
        if (
          item.type === "file.changed" &&
          typeof item.payload === "object" &&
          item.payload !== null &&
          "path" in item.payload &&
          typeof item.payload.path === "string"
        )
          guard(item.payload.path);
      }
      if (
        !resolveActiveSession(deps.db, request.cookies.larness_session ?? "", {
          idleTtlMinutes: deps.config.auth.idleTtlMinutes,
        })
      )
        throw new HttpError("UNAUTHENTICATED", "Client session expired");
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof FileManagerError) {
        appendAudit(deps.db, {
          action: "resource.replay.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "file",
          details: { code: error.code },
        });
        throw new HttpError(error.code, error.message);
      }
      throw new HttpError("INTERNAL", "Resource replay failed");
    }
  });
}
