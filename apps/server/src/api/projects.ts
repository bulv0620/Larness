import { DEFAULT_PROJECT_ID, ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import {
  createProject,
  deleteProject,
  getDefaultProjectDto,
  getProjectDto,
  listProjectDtos,
  ProjectError,
  type ProjectSettings,
  ProjectSettingsSchema,
  updateProject,
} from "../modules/projects/service.js";

const CreateProjectSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    rootPath: z.string().min(1).max(4096),
  })
  .strict();

const UpdateProjectSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    settings: ProjectSettingsSchema.partial().optional(),
  })
  .strict();

const ProjectIdSchema = z.string().min(1).max(128);

export interface ProjectApiDeps {
  db: Database;
  dataDir: string;
  now?: () => number;
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

function throwProject(error: unknown): never {
  if (error instanceof ProjectError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectApiDeps): void {
  app.get("/api/projects", async () => {
    return { projects: [await getDefaultProjectDto(deps.dataDir), ...listProjectDtos(deps.db)] };
  });

  app.post("/api/projects", async (request, reply) => {
    const body = parse(CreateProjectSchema, request.body);

    try {
      const project = await createProject(
        { db: deps.db, now: deps.now, dataDir: deps.dataDir },
        {
          name: body.name,
          rootPath: body.rootPath,
          clientSessionId: request.clientSession?.id,
        },
      );
      return reply.code(201).send(project);
    } catch (error) {
      throwProject(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const id = parse(ProjectIdSchema, request.params.id);

    try {
      return id === DEFAULT_PROJECT_ID
        ? await getDefaultProjectDto(deps.dataDir)
        : getProjectDto(deps.db, id);
    } catch (error) {
      throwProject(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const id = parse(ProjectIdSchema, request.params.id);
    const body = parse(UpdateProjectSchema, request.body);

    try {
      return updateProject(
        { db: deps.db, now: deps.now, dataDir: deps.dataDir },
        {
          id,
          name: body.name,
          settings: body.settings as Partial<ProjectSettings> | undefined,
          clientSessionId: request.clientSession?.id,
        },
      );
    } catch (error) {
      throwProject(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const id = parse(ProjectIdSchema, request.params.id);

    try {
      deleteProject(
        { db: deps.db, now: deps.now, dataDir: deps.dataDir },
        { id, clientSessionId: request.clientSession?.id },
      );
      return { ok: true };
    } catch (error) {
      throwProject(error);
    }
  });
}
