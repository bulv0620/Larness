import { execFile } from "node:child_process";
import path from "node:path";
import { canonicalDirectory, PathGuardError } from "@larness/resources";
import type { ErrorCode } from "@larness/shared";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ProjectRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import {
  createProjectRow,
  deleteProjectRow,
  findProjectByRealPath,
  getProjectById,
  listProjects,
  updateProjectRow,
} from "./repository.js";

export const ProjectSettingsSchema = z
  .object({
    defaultModelProfileId: z.string().min(1).max(128).nullable().default(null),
    instructions: z.string().max(20_000).default(""),
    ignore: z.array(z.string().min(1).max(512)).max(500).default([]),
  })
  .strict();

export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  rootPath: string;
  realPath: string;
  settings: ProjectSettings;
  gitDetected: boolean;
  createdAt: number;
  updatedAt: number;
}

export class ProjectError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.details = details;
  }
}

export type GitDetector = (root: string) => Promise<boolean>;

export interface ProjectServiceOptions {
  db: Database;
  now?: () => number;
  detectGit?: GitDetector;
}

const EMPTY_SETTINGS: ProjectSettings = {
  defaultModelProfileId: null,
  instructions: "",
  ignore: [],
};

export function defaultProjectSettings(): ProjectSettings {
  return structuredClone(EMPTY_SETTINGS);
}

export function parseProjectSettings(json: string): ProjectSettings {
  try {
    const parsed = ProjectSettingsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : defaultProjectSettings();
  } catch {
    return defaultProjectSettings();
  }
}

function rowToDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    rootPath: row.rootPath,
    realPath: row.realPath,
    settings: parseProjectSettings(row.settingsJson),
    gitDetected: row.gitDetected,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function detectGit(root: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      { timeout: 5_000, windowsHide: true, maxBuffer: 64 * 1024 },
      (error) => resolve(error === null),
    );
  });
}

function mapPathError(error: unknown): never {
  if (error instanceof PathGuardError) {
    throw new ProjectError(
      "VALIDATION_ERROR",
      error.code === "NOT_FOUND" ? "project directory does not exist" : error.message,
    );
  }

  throw error;
}

export function listProjectDtos(db: Database): ProjectDto[] {
  return listProjects(db).map(rowToDto);
}

export function getProjectDto(db: Database, id: string): ProjectDto {
  const row = getProjectById(db, id);

  if (row === null) {
    throw new ProjectError("NOT_FOUND", "project not found");
  }

  return rowToDto(row);
}

export async function createProject(
  options: ProjectServiceOptions,
  input: { name?: string; rootPath: string; clientSessionId?: string },
): Promise<ProjectDto> {
  if (!path.isAbsolute(input.rootPath)) {
    throw new ProjectError("VALIDATION_ERROR", "rootPath must be absolute");
  }

  let realPath: string;

  try {
    realPath = await canonicalDirectory(input.rootPath);
  } catch (error) {
    mapPathError(error);
  }

  if (findProjectByRealPath(options.db, realPath) !== null) {
    throw new ProjectError("CONFLICT", "project directory is already registered");
  }

  const name = input.name?.trim() || path.basename(realPath);
  if (name.length === 0 || name.length > 128) {
    throw new ProjectError("VALIDATION_ERROR", "project name must be 1-128 characters");
  }

  const now = options.now?.() ?? Date.now();
  const gitDetected = await (options.detectGit ?? detectGit)(realPath);
  const settingsJson = JSON.stringify(defaultProjectSettings());
  const row = immediateTransaction(options.db, (tx) => {
    const created = createProjectRow(tx, {
      name,
      rootPath: input.rootPath,
      realPath,
      settingsJson,
      gitDetected,
      now,
    });

    appendAudit(tx, {
      action: "project.created",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "project",
      resourceId: created.id,
      details: { name: created.name, realPath: created.realPath, gitDetected },
      now,
    });

    return created;
  });

  return rowToDto(row);
}

export function updateProject(
  options: ProjectServiceOptions,
  input: {
    id: string;
    name?: string;
    settings?: Partial<ProjectSettings>;
    clientSessionId?: string;
  },
): ProjectDto {
  const current = getProjectById(options.db, input.id);

  if (current === null) {
    throw new ProjectError("NOT_FOUND", "project not found");
  }

  const name = input.name?.trim();
  if (name !== undefined && (name.length === 0 || name.length > 128)) {
    throw new ProjectError("VALIDATION_ERROR", "project name must be 1-128 characters");
  }

  let settingsJson: string | undefined;
  if (input.settings !== undefined) {
    const merged = { ...parseProjectSettings(current.settingsJson), ...input.settings };
    const parsed = ProjectSettingsSchema.safeParse(merged);

    if (!parsed.success) {
      throw new ProjectError("VALIDATION_ERROR", "invalid project settings", parsed.error.issues);
    }

    settingsJson = JSON.stringify(parsed.data);
  }

  const now = options.now?.() ?? Date.now();
  const updated = immediateTransaction(options.db, (tx) => {
    const row = updateProjectRow(tx, input.id, { name, settingsJson, updatedAt: now });

    if (row === null) {
      throw new ProjectError("NOT_FOUND", "project not found");
    }

    appendAudit(tx, {
      action: "project.updated",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "project",
      resourceId: row.id,
      details: { name: row.name },
      now,
    });

    return row;
  });

  return rowToDto(updated);
}

export function deleteProject(
  options: ProjectServiceOptions,
  input: { id: string; clientSessionId?: string },
): void {
  const current = getProjectById(options.db, input.id);

  if (current === null) {
    throw new ProjectError("NOT_FOUND", "project not found");
  }

  const now = options.now?.() ?? Date.now();
  immediateTransaction(options.db, (tx) => {
    deleteProjectRow(tx, input.id);
    appendAudit(tx, {
      action: "project.deleted",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "project",
      resourceId: current.id,
      details: { name: current.name, realPath: current.realPath },
      now,
    });
  });
}
