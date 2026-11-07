import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import { listSessionEvents } from "../modules/agent/events.js";
import { SessionError } from "../modules/sessions/errors.js";
import {
  archiveSession,
  createSession,
  getSessionDetail,
  listSessionDtos,
  updateSession,
} from "../modules/sessions/service.js";
import { cancelTurn, createTurn } from "../modules/sessions/turns.js";
import { publishWorkspaceSessionsChanged } from "../ws/publisher.js";

const SessionIdSchema = z.string().min(1).max(128);

const CreateSessionSchema = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(128).optional(),
  })
  .strict();

const UpdateSessionSchema = z
  .object({
    title: z.string().min(1).max(128).optional(),
    modelProfileId: z.string().min(1).max(128).nullable().optional(),
    model: z.string().min(1).max(128).nullable().optional(),
    thinking: z.string().min(1).max(32).nullable().optional(),
    approvalPolicyId: z.enum(["standard", "strict", "readonly", "autonomous"]).optional(),
  })
  .strict();

const CreateTurnSchema = z
  .object({
    input: z.string().min(1).max(100_000),
    modelProfileId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(128).optional(),
    thinking: z.string().min(1).max(32).optional(),
  })
  .strict();

const ListSessionsQuerySchema = z.object({
  projectId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ListEventsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export interface TurnControls {
  enqueue(turnId: string, sessionId: string): void;
  cancel(turnId: string): boolean;
}

export interface SessionApiDeps {
  db: Database;
  dataDir: string;
  now?: () => number;
  turnControls?: TurnControls;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new HttpError("VALIDATION_ERROR", "Invalid request", {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

function throwSession(error: unknown): never {
  if (error instanceof SessionError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

function readIdempotencyKey(value: string | string[] | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    throw new HttpError("VALIDATION_ERROR", "Idempotency-Key must be a single value");
  }

  const key = value.trim();

  if (key.length === 0) {
    throw new HttpError("VALIDATION_ERROR", "Idempotency-Key must not be empty");
  }

  return key;
}

export function registerSessionRoutes(app: FastifyInstance, deps: SessionApiDeps): void {
  const options = { db: deps.db, dataDir: deps.dataDir, now: deps.now };

  app.get("/api/sessions", async (request) => {
    const query = parse(ListSessionsQuerySchema, request.query);
    return {
      sessions: listSessionDtos(options, {
        projectId: query.projectId,
        limit: query.limit,
      }),
    };
  });

  app.post("/api/sessions", async (request, reply) => {
    const body = parse(CreateSessionSchema, request.body);

    try {
      const session = await createSession(options, {
        projectId: body.projectId,
        title: body.title,
        clientSessionId: request.clientSession?.id,
      });
      return reply.code(201).send(session);
    } catch (error) {
      throwSession(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);

    try {
      return getSessionDetail(options, id);
    } catch (error) {
      throwSession(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/sessions/:id", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);
    const body = parse(UpdateSessionSchema, request.body);

    try {
      return updateSession(options, {
        id,
        title: body.title,
        modelProfileId: body.modelProfileId,
        model: body.model,
        thinking: body.thinking,
        approvalPolicyId: body.approvalPolicyId,
        clientSessionId: request.clientSession?.id,
      });
    } catch (error) {
      throwSession(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);

    try {
      archiveSession(options, { id, clientSessionId: request.clientSession?.id });
      return { ok: true };
    } catch (error) {
      throwSession(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/turns", async (request, reply) => {
    const id = parse(SessionIdSchema, request.params.id);
    const body = parse(CreateTurnSchema, request.body);
    const idempotencyKey = readIdempotencyKey(request.headers["idempotency-key"]);

    try {
      const turn = createTurn(options, {
        sessionId: id,
        text: body.input,
        modelProfileId: body.modelProfileId,
        model: body.model,
        thinking: body.thinking,
        idempotencyKey,
        clientSessionId: request.clientSession?.id,
      });
      if (turn.status === "QUEUED") publishWorkspaceSessionsChanged();
      deps.turnControls?.enqueue(turn.turnId, turn.sessionId);
      return reply.code(202).send(turn);
    } catch (error) {
      throwSession(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/turns/:id/cancel", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);

    try {
      const result = cancelTurn(options, {
        turnId: id,
        clientSessionId: request.clientSession?.id,
      });
      deps.turnControls?.cancel(result.turnId);
      return result;
    } catch (error) {
      throwSession(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/events", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);
    const query = parse(ListEventsQuerySchema, request.query);

    try {
      return listSessionEvents(deps.db, id, {
        after: query.after,
        limit: query.limit,
      });
    } catch (error) {
      throwSession(error);
    }
  });
}
