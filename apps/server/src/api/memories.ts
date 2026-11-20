import {
  ERROR_HTTP_STATUS,
  MemoryKeySchema,
  MemoryKindSchema,
  MemoryStatusSchema,
} from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import { memoryById } from "../modules/memory/repository.js";
import { MemoryError, type MemoryService } from "../modules/memory/service.js";

const IdSchema = z.string().min(1).max(128);

const ListQuerySchema = z
  .object({
    status: MemoryStatusSchema.optional(),
    kind: MemoryKindSchema.optional(),
    q: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const CreateMemorySchema = z
  .object({
    kind: MemoryKindSchema,
    key: MemoryKeySchema,
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4_000),
    expiresAt: z.number().int().nullable().optional(),
  })
  .strict();

const UpdateMemorySchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    body: z.string().trim().min(1).max(4_000).optional(),
    expiresAt: z.number().int().nullable().optional(),
    pinned: z.boolean().optional(),
    status: z.enum(["active", "rejected"]).optional(),
    expectedUpdatedAt: z.number().int(),
  })
  .strict();

const ExpectedQuerySchema = z
  .object({
    expectedUpdatedAt: z.coerce.number().int(),
  })
  .strict();

export interface MemoryApiDeps {
  db: Database;
  memory: MemoryService;
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

function throwMemory(error: unknown): never {
  if (error instanceof MemoryError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

function requireMemory(
  deps: MemoryApiDeps,
  id: string,
  scope: "project" | "global",
  projectId: string | null,
) {
  const row = memoryById(deps.db, id);

  if (
    row === null ||
    row.scope !== scope ||
    (scope === "project" && row.projectId !== projectId) ||
    (scope === "global" && row.projectId !== null)
  ) {
    throw new HttpError("MEMORY_NOT_FOUND", "memory not found");
  }

  return row;
}

export function registerMemoryRoutes(app: FastifyInstance, deps: MemoryApiDeps): void {
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/memories",
    async (request) => {
      const projectId = parse(IdSchema, request.params.id);
      const query = parse(ListQuerySchema, request.query);
      try {
        return deps.memory.listProject(projectId, query);
      } catch (error) {
        throwMemory(error);
      }
    },
  );

  app.get<{ Params: { id: string } }>("/api/projects/:id/memories/budget", async (request) => {
    const projectId = parse(IdSchema, request.params.id);
    try {
      return deps.memory.budget("project", projectId);
    } catch (error) {
      throwMemory(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/memories", async (request, reply) => {
    const projectId = parse(IdSchema, request.params.id);
    const body = parse(CreateMemorySchema, request.body);
    try {
      const memory = deps.memory.createUser({
        scope: "project",
        projectId,
        ...body,
      });
      return reply.code(201).send(memory);
    } catch (error) {
      throwMemory(error);
    }
  });

  app.patch<{ Params: { id: string; memoryId: string } }>(
    "/api/projects/:id/memories/:memoryId",
    async (request) => {
      const projectId = parse(IdSchema, request.params.id);
      const memoryId = parse(IdSchema, request.params.memoryId);
      const body = parse(UpdateMemorySchema, request.body);
      requireMemory(deps, memoryId, "project", projectId);
      try {
        return deps.memory.update(memoryId, body, "user");
      } catch (error) {
        throwMemory(error);
      }
    },
  );

  app.delete<{ Params: { id: string; memoryId: string }; Querystring: unknown }>(
    "/api/projects/:id/memories/:memoryId",
    async (request) => {
      const projectId = parse(IdSchema, request.params.id);
      const memoryId = parse(IdSchema, request.params.memoryId);
      const expected = parse(ExpectedQuerySchema, request.query);
      const row = requireMemory(deps, memoryId, "project", projectId);
      if (row.updatedAt !== expected.expectedUpdatedAt) {
        throw new HttpError("VERSION_CONFLICT", "memory was changed by another client");
      }
      try {
        deps.memory.forget(memoryId, "user");
        return { ok: true };
      } catch (error) {
        throwMemory(error);
      }
    },
  );

  app.post<{ Params: { id: string; memoryId: string } }>(
    "/api/projects/:id/memories/:memoryId/restore",
    async (request) => {
      const projectId = parse(IdSchema, request.params.id);
      const memoryId = parse(IdSchema, request.params.memoryId);
      requireMemory(deps, memoryId, "project", projectId);
      try {
        return deps.memory.restore(memoryId, "user");
      } catch (error) {
        throwMemory(error);
      }
    },
  );

  app.get<{ Querystring: unknown }>("/api/memories/global", async (request) => {
    const query = parse(ListQuerySchema, request.query);
    try {
      return deps.memory.listGlobal(query);
    } catch (error) {
      throwMemory(error);
    }
  });

  app.get("/api/memories/global/budget", async () => {
    try {
      return deps.memory.budget("global", null);
    } catch (error) {
      throwMemory(error);
    }
  });

  app.post("/api/memories/global", async (request, reply) => {
    const body = parse(CreateMemorySchema, request.body);
    try {
      const memory = deps.memory.createUser({
        scope: "global",
        projectId: null,
        ...body,
      });
      return reply.code(201).send(memory);
    } catch (error) {
      throwMemory(error);
    }
  });

  app.patch<{ Params: { memoryId: string } }>("/api/memories/global/:memoryId", async (request) => {
    const memoryId = parse(IdSchema, request.params.memoryId);
    const body = parse(UpdateMemorySchema, request.body);
    requireMemory(deps, memoryId, "global", null);
    try {
      return deps.memory.update(memoryId, body, "user");
    } catch (error) {
      throwMemory(error);
    }
  });

  app.delete<{ Params: { memoryId: string }; Querystring: unknown }>(
    "/api/memories/global/:memoryId",
    async (request) => {
      const memoryId = parse(IdSchema, request.params.memoryId);
      const expected = parse(ExpectedQuerySchema, request.query);
      const row = requireMemory(deps, memoryId, "global", null);
      if (row.updatedAt !== expected.expectedUpdatedAt) {
        throw new HttpError("VERSION_CONFLICT", "memory was changed by another client");
      }
      try {
        deps.memory.forget(memoryId, "user");
        return { ok: true };
      } catch (error) {
        throwMemory(error);
      }
    },
  );

  app.post<{ Params: { memoryId: string } }>(
    "/api/memories/global/:memoryId/restore",
    async (request) => {
      const memoryId = parse(IdSchema, request.params.memoryId);
      requireMemory(deps, memoryId, "global", null);
      try {
        return deps.memory.restore(memoryId, "user");
      } catch (error) {
        throwMemory(error);
      }
    },
  );
}
