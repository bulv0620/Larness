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
  type ProjectDto,
  ProjectError,
  type ProjectSettings,
  ProjectSettingsSchema,
  reorderProjects,
  updateProject,
} from "../modules/projects/service.js";
import { runningTerminalCounts } from "../modules/terminals/repository.js";

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

const ReorderProjectsSchema = z
  .object({
    projectIds: z.array(ProjectIdSchema).min(1).max(1_000),
  })
  .strict();

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

type ProjectWithActivity = ProjectDto & { runningTerminals: number };

function withRunningTerminals(
  project: ProjectDto,
  counts: Map<string | null, number>,
): ProjectWithActivity {
  return {
    ...project,
    runningTerminals: counts.get(project.kind === "default" ? null : project.id) ?? 0,
  };
}

function withProjectActivity(db: Database, project: ProjectDto): ProjectWithActivity {
  return withRunningTerminals(project, runningTerminalCounts(db));
}

function withProjectsActivity(db: Database, projects: ProjectDto[]): ProjectWithActivity[] {
  const counts = runningTerminalCounts(db);
  return projects.map((project) => withRunningTerminals(project, counts));
}

export function registerProjectRoutes(app: FastifyInstance, deps: ProjectApiDeps): void {
  app.get("/api/projects", async () => {
    return {
      projects: withProjectsActivity(deps.db, [
        await getDefaultProjectDto(deps.dataDir),
        ...listProjectDtos(deps.db),
      ]),
    };
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
      return reply.code(201).send(withProjectActivity(deps.db, project));
    } catch (error) {
      throwProject(error);
    }
  });

  app.put("/api/projects/order", async (request) => {
    const body = parse(ReorderProjectsSchema, request.body);

    try {
      return {
        projects: withProjectsActivity(
          deps.db,
          reorderProjects(
            { db: deps.db, now: deps.now, dataDir: deps.dataDir },
            {
              projectIds: body.projectIds,
              clientSessionId: request.clientSession?.id,
            },
          ),
        ),
      };
    } catch (error) {
      throwProject(error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const id = parse(ProjectIdSchema, request.params.id);

    try {
      return withProjectActivity(
        deps.db,
        id === DEFAULT_PROJECT_ID
          ? await getDefaultProjectDto(deps.dataDir)
          : getProjectDto(deps.db, id),
      );
    } catch (error) {
      throwProject(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (request) => {
    const id = parse(ProjectIdSchema, request.params.id);
    const body = parse(UpdateProjectSchema, request.body);

    try {
      return withProjectActivity(
        deps.db,
        updateProject(
          { db: deps.db, now: deps.now, dataDir: deps.dataDir },
          {
            id,
            name: body.name,
            settings: body.settings as Partial<ProjectSettings> | undefined,
            clientSessionId: request.clientSession?.id,
          },
        ),
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
