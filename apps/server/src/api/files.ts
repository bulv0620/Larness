import { FileManagerError } from "@larness/resources";
import {
  FileActionSchema,
  FileListQuerySchema,
  FileReadQuerySchema,
  FileSaveSchema,
  FileScopeSchema,
  FileSearchQuerySchema,
} from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import { applyFileAction } from "../modules/files/actions.js";
import { knownCredentialGuard } from "../modules/files/credentials.js";
import {
  type FileServiceOptions,
  findFiles,
  getDirectory,
  getFile,
  saveFile,
} from "../modules/files/service.js";
import type { ResourceEventBus } from "../modules/resources/events.js";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError("VALIDATION_ERROR", "Invalid file request");
  return result.data;
}
export function registerFileRoutes(
  app: FastifyInstance,
  deps: AppServices,
  events?: ResourceEventBus,
) {
  const options = (request: FastifyRequest): FileServiceOptions => ({
    db: deps.db,
    dataDir: deps.dataDir,
    publish: (row) => events?.publish(row),
    assertClient: () => {
      const session = resolveActiveSession(deps.db, request.cookies.larness_session ?? "", {
        idleTtlMinutes: deps.config.auth.idleTtlMinutes,
      });
      if (!session || session.id !== request.clientSession?.id)
        throw new FileManagerError("UNAUTHENTICATED", "Client session expired");
    },
    assertContent: knownCredentialGuard(deps.db, deps.secretStore),
  });
  async function run<T>(request: FastifyRequest, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof HttpError) {
        appendAudit(deps.db, {
          action: "file.request.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "file",
          details: { code: error.code },
          now: Date.now(),
        });
        throw error;
      }
      if (error instanceof FileManagerError) {
        appendAudit(deps.db, {
          action: "file.access.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "file",
          details: { code: error.code },
          now: Date.now(),
        });
        throw new HttpError(error.code, error.message, { details: error.details });
      }
      // No raw filesystem paths/content/driver errors reach request logging.
      throw new HttpError("INTERNAL", "File operation failed");
    }
  }
  app.get("/api/files", async (request) =>
    run(request, async () => {
      const query = parse(FileReadQuerySchema, request.query);
      const scope =
        "projectId" in query
          ? { projectId: query.projectId }
          : "sessionId" in query
            ? { sessionId: query.sessionId }
            : { workspace: "default" as const };
      return getFile(options(request), scope, query);
    }),
  );
  app.put("/api/files", async (request) =>
    run(request, async () => {
      const body = parse(FileSaveSchema, request.body);
      const key = request.headers["idempotency-key"];
      const idempotencyKey =
        key === undefined ? undefined : parse(z.string().trim().min(1).max(128), key);
      const client = request.clientSession;
      if (!client) throw new HttpError("UNAUTHENTICATED", "Authentication required");
      return saveFile(options(request), body, client.id, idempotencyKey);
    }),
  );
  app.post("/api/files/actions", async (request) =>
    run(request, async () => {
      const input = parse(FileActionSchema, request.body);
      const key = parse(z.string().trim().min(1).max(128), request.headers["idempotency-key"]);
      if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
      return applyFileAction(options(request), input, request.clientSession.id, key);
    }),
  );
  for (const kind of ["projects", "sessions", "workspaces"] as const) {
    const scopeFor = (id: string) =>
      parse(
        FileScopeSchema,
        kind === "projects"
          ? { projectId: id }
          : kind === "sessions"
            ? { sessionId: id }
            : { workspace: id },
      );
    app.get<{ Params: { id: string } }>(`/api/${kind}/:id/files`, async (request) =>
      run(request, async () => {
        const query = parse(FileListQuerySchema, request.query);
        return getDirectory(options(request), scopeFor(request.params.id), query);
      }),
    );
    app.get<{ Params: { id: string } }>(`/api/${kind}/:id/files/search`, async (request) =>
      run(request, async () => {
        const { q } = parse(FileSearchQuerySchema, request.query);
        return findFiles(options(request), scopeFor(request.params.id), q);
      }),
    );
  }
}
