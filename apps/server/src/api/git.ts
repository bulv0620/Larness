import { FileManagerError, GitError } from "@larness/resources";
import {
  GitActionDecisionSchema,
  GitActionSchema,
  GitBranchesQuerySchema,
  GitDiffQuerySchema,
  GitLogQuerySchema,
} from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppServices } from "../app.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { appendAudit } from "../db/repositories/audit.js";
import { HttpError } from "../errors.js";
import type { GitManager } from "../modules/git/manager.js";

const ProjectParams = z.object({ id: z.string().min(1).max(128) }).strict();
const ActionParams = z.object({ id: z.string().min(1).max(128) }).strict();

function mapFailure(error: unknown): HttpError {
  if (error instanceof GitError) return new HttpError(error.code, error.message);
  if (error instanceof HttpError) return error;
  if (error instanceof FileManagerError) return new HttpError(error.code, error.message);
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return new HttpError(code as never, (error as Error).message);
  return new HttpError("INTERNAL", "Git operation failed");
}

export function registerGitRoutes(app: FastifyInstance, deps: AppServices, git: GitManager): void {
  const client = (request: FastifyRequest) => {
    const session = resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });
    if (!session) throw new HttpError("UNAUTHENTICATED", "Client session expired");
    return session.id;
  };
  const projectId = (request: FastifyRequest) => {
    const parsed = ProjectParams.safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid project ID");
    return parsed.data.id;
  };
  const actionId = (request: FastifyRequest) => {
    const parsed = ActionParams.safeParse(request.params);
    if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid action ID");
    return parsed.data.id;
  };
  async function run(request: FastifyRequest, action: () => unknown | Promise<unknown>) {
    try {
      client(request);
      const result = await action();
      client(request);
      return result;
    } catch (error) {
      const failure = mapFailure(error);
      try {
        appendAudit(deps.db, {
          action: "git.denied",
          decision: "deny",
          clientSessionId: request.clientSession?.id,
          resourceType: "git",
          details: { code: failure.code, requestId: request.id },
        });
      } catch {
        throw new HttpError("INTERNAL", "Git audit unavailable");
      }
      throw failure;
    }
  }
  app.get("/api/projects/:id/git/status", (request) =>
    run(request, () => git.status(projectId(request))),
  );
  app.get("/api/projects/:id/git/diff", (request) =>
    run(request, () => {
      const parsed = GitDiffQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid Git diff query");
      return git.diff(projectId(request), parsed.data.path, parsed.data.staged === "true");
    }),
  );
  app.get("/api/projects/:id/git/log", (request) =>
    run(request, () => {
      const parsed = GitLogQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid Git log query");
      return { items: git.log(projectId(request), parsed.data.limit, parsed.data.cursor) };
    }),
  );
  app.get("/api/projects/:id/git/branches", (request) =>
    run(request, () => {
      const parsed = GitBranchesQuerySchema.safeParse(request.query);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid Git branch query");
      return { items: git.branches(projectId(request), parsed.data.limit, parsed.data.cursor) };
    }),
  );
  app.post("/api/projects/:id/git/actions", async (request, reply) => {
    const result = await run(request, () => {
      const parsed = GitActionSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid Git action");
      return git.createAction(projectId(request), parsed.data, client(request));
    });
    return reply.code(201).send(result);
  });
  app.get("/api/resource-actions/:id", (request) =>
    run(request, () => git.action(actionId(request))),
  );
  app.post("/api/resource-actions/:id/decision", (request) =>
    run(request, () => {
      const parsed = GitActionDecisionSchema.safeParse(request.body);
      if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid Git decision");
      return git.decideAction(actionId(request), parsed.data.decision, client(request));
    }),
  );
  app.post("/api/resource-actions/:id/execute", (request) =>
    run(request, async () => {
      const body = request.body as unknown;
      if (
        body !== undefined &&
        body !== null &&
        (!(typeof body === "object") || Object.keys(body).length > 0)
      )
        throw new HttpError("VALIDATION_ERROR", "Git execution takes no parameters");
      return git.executeAction(actionId(request), client(request));
    }),
  );
}
