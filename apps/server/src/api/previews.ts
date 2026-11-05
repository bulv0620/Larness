import { FileManagerError } from "@larness/resources";
import { ServiceIdSchema } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { HttpError } from "../errors.js";
import type { PreviewRegistry } from "../modules/previews/registry.js";

const ResolveSchema = z
  .object({
    serviceId: ServiceIdSchema,
    path: z.string().min(1).max(2048).optional(),
    mode: z.enum(["embedded", "external"]).default("embedded"),
  })
  .strict();

export function registerPreviewRoutes(
  app: FastifyInstance,
  deps: Pick<AppServices, "db" | "config">,
  registry: PreviewRegistry | null,
): void {
  const session = (request: FastifyRequest) => {
    const active = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!active) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return active;
  };
  app.post("/api/previews/resolve", async (request, reply) => {
    try {
      const active = session(request);
      if (!registry) throw new HttpError("PREVIEW_UNAVAILABLE", "Preview is not enabled");
      const parsed = ResolveSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid preview request");
      const result = await registry.resolve(parsed.data, active.id);
      reply.header("cache-control", "no-store");
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof FileManagerError) throw new HttpError(error.code, error.message);
      throw new HttpError("INTERNAL", "Preview resolve failed");
    }
  });
}
