import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import { listSessionEvents } from "../modules/agent/events.js";
import { ResumeError, resumeInterruptedTurn } from "../modules/agent/recovery/resume.js";
import {
  type AttachmentService,
  attachmentUploadSchema,
  MAX_ATTACHMENT_REQUEST_BYTES,
} from "../modules/attachments/service.js";
import {
  AttachmentError,
  type AttachmentErrorCode,
  MAX_SOURCE_PREVIEW_CHARS,
} from "../modules/attachments/types.js";
import { attachmentIdsSchema, readScreenshots } from "../modules/sessions/attachments.js";
import { SessionError } from "../modules/sessions/errors.js";
import {
  archiveSession,
  createSession,
  getSessionDetail,
  listSessionDtos,
  updateSession,
} from "../modules/sessions/service.js";
import { cancelTurn, createTurn } from "../modules/sessions/turns.js";
import { getSessionUsage } from "../modules/sessions/usage.js";
import { hasActiveWebSearchConnection } from "../modules/web-search/connections.js";
import { publishWorkspaceSessionsChanged } from "../ws/publisher.js";

const SessionIdSchema = z.string().min(1).max(128);

const CreateSessionSchema = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
    title: z.string().min(1).max(128).optional(),
    agentProfile: z.enum(["coding", "plan"]).optional(),
  })
  .strict();

const UpdateSessionSchema = z
  .object({
    title: z.string().min(1).max(128).optional(),
    modelProfileId: z.string().min(1).max(128).nullable().optional(),
    model: z.string().min(1).max(128).nullable().optional(),
    thinking: z.string().min(1).max(32).nullable().optional(),
    credentialProfileId: z.string().min(1).max(128).nullable().optional(),
    agentProfile: z.enum(["coding", "plan"]).optional(),
    approvalPolicyId: z.enum(["standard", "strict", "readonly", "autonomous"]).optional(),
    webSearchEnabled: z.boolean().optional(),
  })
  .strict();

const CreateTurnSchema = z
  .object({
    input: z.string().max(100_000),
    attachmentIds: attachmentIdsSchema.optional(),
    modelProfileId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(128).optional(),
    thinking: z.string().min(1).max(32).optional(),
    credentialProfileId: z.string().min(1).max(128).optional(),
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

const AttachmentSourceQuerySchema = z.object({
  line: z.coerce.number().int().min(1).optional(),
  maxChars: z.coerce.number().int().min(1).max(MAX_SOURCE_PREVIEW_CHARS).optional(),
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
  attachments?: AttachmentService;
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

function throwAttachment(error: unknown): never {
  if (error instanceof AttachmentError) {
    throw new HttpError(error.code as AttachmentErrorCode, error.message, {
      status: ERROR_HTTP_STATUS[error.code as AttachmentErrorCode],
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
        agentProfile: body.agentProfile,
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

    if (body.webSearchEnabled === true && !hasActiveWebSearchConnection(options.db)) {
      throw new HttpError("VALIDATION_ERROR", "configure a web search connection first");
    }

    try {
      return updateSession(options, {
        id,
        title: body.title,
        modelProfileId: body.modelProfileId,
        model: body.model,
        thinking: body.thinking,
        credentialProfileId: body.credentialProfileId,
        agentProfile: body.agentProfile,
        approvalPolicyId: body.approvalPolicyId,
        webSearchEnabled: body.webSearchEnabled,
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

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/attachments",
    { bodyLimit: MAX_ATTACHMENT_REQUEST_BYTES },
    async (request, reply) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments === undefined) {
        throw new HttpError("ATTACHMENT_UNSUPPORTED", "attachments are not enabled");
      }
      const body = parse(attachmentUploadSchema, request.body);
      try {
        const result = await deps.attachments.upload(id, body);
        return reply.code(201).send({ id: result.attachment.id, ...result });
      } catch (error) {
        throwAttachment(error);
      }
    },
  );
  app.get<{ Params: { id: string; attachmentId: string } }>(
    "/api/sessions/:id/attachments/:attachmentId",
    async (request, reply) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments !== undefined) {
        try {
          const { row, bytes } = await deps.attachments.readOriginal(
            id,
            request.params.attachmentId,
          );
          return reply
            .type(row.mime)
            .header("Cache-Control", "private, no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header(
              "Content-Disposition",
              `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
            )
            .send(bytes);
        } catch (error) {
          throwAttachment(error);
        }
      }
      const ids = parse(attachmentIdsSchema, [request.params.attachmentId]);
      try {
        const row = readScreenshots(options.db, id, ids)[0];
        if (!row) throw new SessionError("NOT_FOUND", "screenshot not found");
        return reply
          .type(row.mime)
          .header("Cache-Control", "private, no-store")
          .header("X-Content-Type-Options", "nosniff")
          .send(row.bytes);
      } catch (error) {
        throwSession(error);
      }
    },
  );

  app.post<{ Params: { id: string; attachmentId: string } }>(
    "/api/sessions/:id/attachments/:attachmentId/transcribe",
    async (request) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments === undefined) {
        throw new HttpError("ATTACHMENT_UNSUPPORTED", "attachments are not enabled");
      }
      try {
        return {
          attachment: await deps.attachments.transcribeImage(id, request.params.attachmentId),
        };
      } catch (error) {
        throwAttachment(error);
      }
    },
  );

  app.get<{ Params: { id: string; attachmentId: string } }>(
    "/api/sessions/:id/attachments/:attachmentId/artifact",
    async (request) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments === undefined) {
        throw new HttpError("ATTACHMENT_UNSUPPORTED", "attachments are not enabled");
      }
      try {
        return await deps.attachments.readArtifact(id, request.params.attachmentId);
      } catch (error) {
        throwAttachment(error);
      }
    },
  );

  app.get<{ Params: { id: string; attachmentId: string } }>(
    "/api/sessions/:id/attachments/:attachmentId/source",
    async (request) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments === undefined) {
        throw new HttpError("ATTACHMENT_UNSUPPORTED", "attachments are not enabled");
      }
      const query = parse(AttachmentSourceQuerySchema, request.query);
      try {
        return await deps.attachments.readSource(id, request.params.attachmentId, {
          ...(query.line === undefined ? {} : { line: query.line }),
          ...(query.maxChars === undefined ? {} : { maxChars: query.maxChars }),
        });
      } catch (error) {
        throwAttachment(error);
      }
    },
  );

  app.delete<{ Params: { id: string; attachmentId: string } }>(
    "/api/sessions/:id/attachments/:attachmentId",
    async (request, reply) => {
      const id = parse(SessionIdSchema, request.params.id);
      if (deps.attachments === undefined) {
        throw new HttpError("ATTACHMENT_UNSUPPORTED", "attachments are not enabled");
      }
      try {
        await deps.attachments.remove(id, request.params.attachmentId);
        return reply.code(204).send();
      } catch (error) {
        throwAttachment(error);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/sessions/:id/usage", async (request) => {
    const id = parse(SessionIdSchema, request.params.id);

    try {
      return getSessionUsage(deps.db, id);
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
        attachmentIds: body.attachmentIds,
        modelProfileId: body.modelProfileId,
        model: body.model,
        thinking: body.thinking,
        credentialProfileId: body.credentialProfileId,
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

  app.post<{ Params: { id: string } }>("/api/turns/:id/resume", async (request, reply) => {
    const id = parse(SessionIdSchema, request.params.id);

    try {
      const result = resumeInterruptedTurn(
        { db: options.db, now: options.now },
        {
          turnId: id,
          ...(request.clientSession?.id === undefined
            ? {}
            : { clientSessionId: request.clientSession.id }),
        },
      );
      publishWorkspaceSessionsChanged();
      deps.turnControls?.enqueue(result.turnId, result.sessionId);
      return reply.code(202).send(result);
    } catch (error) {
      if (error instanceof ResumeError) {
        throw new HttpError(
          error.code === "TURN_NOT_FOUND" || error.code === "SESSION_NOT_FOUND"
            ? "NOT_FOUND"
            : error.code === "MODEL_UNAVAILABLE"
              ? "RESOURCE_UNAVAILABLE"
              : "CONFLICT",
          error.message,
          { details: { reason: error.code } },
        );
      }

      throw error;
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
