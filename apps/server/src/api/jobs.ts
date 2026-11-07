import {
  ERROR_HTTP_STATUS,
  ScheduledJobInputSchema,
  ScheduledJobPatchSchema,
} from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../errors.js";
import { JobError } from "../modules/jobs/errors.js";
import type { JobService } from "../modules/jobs/service.js";

const IdSchema = z.string().min(1).max(128);
const ListRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(128).optional(),
});

export interface JobApiDeps {
  service: JobService;
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

function throwJob(error: unknown): never {
  if (error instanceof JobError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

export function registerJobRoutes(app: FastifyInstance, deps: JobApiDeps): void {
  app.get("/api/jobs", async () => deps.service.list());

  app.get("/api/jobs/summary", async () => deps.service.summary());

  app.post("/api/jobs", async (request, reply) => {
    const body = parse(ScheduledJobInputSchema, request.body);

    try {
      const job = deps.service.create(body, request.clientSession?.id);
      return reply.code(201).send(job);
    } catch (error) {
      throwJob(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request) => {
    const id = parse(IdSchema, request.params.id);

    try {
      return deps.service.get(id);
    } catch (error) {
      throwJob(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/jobs/:id", async (request) => {
    const id = parse(IdSchema, request.params.id);
    const body = parse(ScheduledJobPatchSchema, request.body);

    try {
      return deps.service.update(id, body, request.clientSession?.id);
    } catch (error) {
      throwJob(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply) => {
    const id = parse(IdSchema, request.params.id);

    try {
      deps.service.archive(id, request.clientSession?.id);
      return reply.code(204).send();
    } catch (error) {
      throwJob(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/run", async (request, reply) => {
    const id = parse(IdSchema, request.params.id);

    try {
      return reply.code(202).send(deps.service.runNow(id, request.clientSession?.id));
    } catch (error) {
      throwJob(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id/runs", async (request) => {
    const id = parse(IdSchema, request.params.id);
    const query = parse(ListRunsQuerySchema, request.query);

    try {
      return deps.service.listRuns(id, query);
    } catch (error) {
      throwJob(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/job-runs/:id", async (request) => {
    const id = parse(IdSchema, request.params.id);

    try {
      return deps.service.getRun(id);
    } catch (error) {
      throwJob(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/job-runs/:id/cancel", async (request) => {
    const id = parse(IdSchema, request.params.id);

    try {
      return deps.service.cancelRun(id, request.clientSession?.id);
    } catch (error) {
      throwJob(error);
    }
  });
}
