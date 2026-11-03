import { FileManagerError } from "@larness/resources";
import { CommandCancelSchema, CommandIdSchema, CommandOutputQuerySchema } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import type { CommandManager } from "../modules/commands/manager.js";

const Id = z.object({ id: CommandIdSchema });
export function registerCommandRoutes(
  app: FastifyInstance,
  deps: AppServices,
  commands: CommandManager,
) {
  async function run(request: FastifyRequest, action: (id: string) => Promise<unknown>) {
    try {
      const parsed = Id.safeParse(request.params);
      if (!parsed.success) throw new FileManagerError("VALIDATION_ERROR", "Invalid command ID");
      const result = await action(parsed.data.id);
      if (
        !resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
          idleTtlMinutes: deps.config.auth.idleTtlMinutes,
        })
      )
        throw new HttpError("UNAUTHENTICATED", "Client session expired");
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof FileManagerError) {
        try {
          appendAudit(deps.db, {
            action: "command.denied",
            decision: "deny",
            clientSessionId: request.clientSession?.id,
            resourceType: "command",
            details: { code: error.code, requestId: request.id },
          });
        } catch {
          throw new HttpError("INTERNAL", "Command authorization unavailable");
        }
        throw new HttpError(error.code, error.message);
      }
      throw new HttpError("INTERNAL", "Command operation failed");
    }
  }
  app.get("/api/commands/:id", (request) => run(request, (id) => commands.read(id)));
  app.get("/api/commands/:id/output", (request) =>
    run(request, (id) => {
      const parsed = CommandOutputQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new FileManagerError("VALIDATION_ERROR", "Invalid output cursor");
      return commands.output(id, parsed.data.after, parsed.data.limit);
    }),
  );
  app.post("/api/commands/:id/cancel", (request) =>
    run(request, (id) => {
      if (
        !CommandCancelSchema.safeParse(request.body ?? {}).success ||
        (request.headers["idempotency-key"] !== undefined &&
          !z.string().min(1).max(128).safeParse(request.headers["idempotency-key"]).success)
      )
        throw new FileManagerError("VALIDATION_ERROR", "Invalid cancel request");
      return commands.cancel(id, request.clientSession?.id, () => {
        if (
          !resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
            idleTtlMinutes: deps.config.auth.idleTtlMinutes,
          })
        )
          throw new HttpError("UNAUTHENTICATED", "Client session expired");
      });
    }),
  );
}
