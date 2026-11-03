import { FileManagerError } from "@larness/resources";
import {
  CommandOutputQuerySchema,
  TerminalIdSchema,
  TerminalLeaseSchema,
  TerminalResizeSchema,
  TerminalTakeoverSchema,
} from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import type { TerminalManager } from "../modules/terminals/manager.js";

const Key = z.string().min(1).max(128);
const List = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    workspaceSessionId: z.string().min(1).max(128).optional(),
    global: z.enum(["true", "false"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: TerminalIdSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      Number(!!value.projectId) +
        Number(!!value.workspaceSessionId) +
        Number(value.global === "true") <=
      1,
  );
export function registerTerminalRoutes(
  app: FastifyInstance,
  deps: AppServices,
  terminals: TerminalManager,
) {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const id = (request: FastifyRequest) => {
    const parsed = z.object({ id: TerminalIdSchema }).safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid terminal ID");
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
        error instanceof FileManagerError || error instanceof HttpError
          ? error
          : new HttpError("INTERNAL", "Terminal operation failed");
      try {
        appendAudit(deps.db, {
          action: "terminal.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "terminal",
          details: { code: failure.code, requestId: request.id },
        });
      } catch {
        throw new HttpError("INTERNAL", "Terminal audit unavailable");
      }
      throw new HttpError(failure.code, failure.message);
    }
  }
  app.get("/api/terminals", (request) =>
    run(request, async () => {
      const parsed = List.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid terminal query");
      return terminals.list({ ...parsed.data, global: parsed.data.global === "true" });
    }),
  );
  app.post("/api/terminals", async (request, reply) => {
    const result = await run(request, async () => {
      const key = Key.safeParse(request.headers["idempotency-key"]);
      if (!key.success) throw new HttpError("VALIDATION_ERROR", "Idempotency-Key required");
      return terminals.create(client(request), key.data, request.body);
    });
    return reply.code(201).send(result);
  });
  app.get("/api/terminals/:id", (request) => run(request, () => terminals.read(id(request))));
  app.get("/api/terminals/:id/output", (request) =>
    run(request, async () => {
      const parsed = CommandOutputQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid output cursor");
      return terminals.output(id(request), parsed.data.after, parsed.data.limit);
    }),
  );
  app.post("/api/terminals/:id/lease", (request) =>
    run(request, async () => {
      const parsed = TerminalLeaseSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError("VALIDATION_ERROR", "Invalid terminal lease request");
      return terminals.lease(id(request), client(request), parsed.data);
    }),
  );
  app.post("/api/terminals/:id/resize", (request) =>
    run(request, async () => {
      const parsed = TerminalResizeSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError("VALIDATION_ERROR", "Invalid terminal resize request");
      return terminals.resize(id(request), client(request), parsed.data);
    }),
  );
  app.post("/api/terminals/:id/takeover", (request) =>
    run(request, async () => {
      const parsed = TerminalTakeoverSchema.safeParse(request.body);
      if (!parsed.success)
        throw new HttpError("VALIDATION_ERROR", "Invalid terminal takeover request");
      return terminals.takeover(id(request), client(request), parsed.data.connectionId);
    }),
  );
  app.post("/api/terminals/:id/terminate", (request) =>
    run(request, async () => {
      if (
        !z
          .object({ confirmed: z.literal(true) })
          .strict()
          .safeParse(request.body).success ||
        (request.headers["idempotency-key"] !== undefined &&
          !Key.safeParse(request.headers["idempotency-key"]).success)
      )
        throw new HttpError("VALIDATION_ERROR", "Explicit termination confirmation required");
      return terminals.terminate(id(request), client(request));
    }),
  );
}
