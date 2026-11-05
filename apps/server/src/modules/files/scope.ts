import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  FileManagerError,
  isInsideRoot,
  normalizeFilePath,
  resolveFilePath,
} from "@larness/resources";
import { DEFAULT_PROJECT_ID, type FileScope } from "@larness/shared";
import type { Database } from "../../db/client.js";
import { getProjectById } from "../projects/repository.js";
import { parseProjectSettings } from "../projects/service.js";
import { getSessionById } from "../sessions/repository.js";
import {
  defaultWorkspacePath,
  ensureDefaultWorkspace,
  isDefaultWorkspace,
} from "../workspaces/default.js";

export async function resolveFileScope(db: Database, dataDir: string, requestedScope: FileScope) {
  const scope: FileScope =
    "projectId" in requestedScope && requestedScope.projectId === DEFAULT_PROJECT_ID
      ? { workspace: "default" }
      : requestedScope;
  let root: string;
  let key: string;
  let ignore: string[] = [];
  if ("projectId" in scope) {
    const project = getProjectById(db, scope.projectId);
    if (!project) throw new FileManagerError("NOT_FOUND", "Project not found");
    root = project.realPath;
    key = `project:${project.id}`;
    ignore = parseProjectSettings(project.settingsJson).ignore;
  } else if ("workspace" in scope) {
    root = await ensureDefaultWorkspace(dataDir);
    key = "workspace:default";
  } else {
    const session = getSessionById(db, scope.sessionId);
    const expected = path.join(dataDir, "sessions", scope.sessionId, "workspace");
    if (
      !session ||
      session.projectId !== null ||
      (path.resolve(session.workspacePath) !== path.resolve(expected) &&
        !isDefaultWorkspace(dataDir, session.workspacePath))
    ) {
      throw new FileManagerError("NOT_FOUND", "Standalone workspace not found");
    }
    root = session.workspacePath;
    key = isDefaultWorkspace(dataDir, session.workspacePath)
      ? "workspace:default"
      : `session:${session.id}`;
    if (key === "workspace:default") await ensureDefaultWorkspace(dataDir);
  }
  let canonical: string;
  try {
    canonical = await realpath(root);
  } catch {
    throw new FileManagerError("RESOURCE_UNAVAILABLE", "Authorized root is unavailable");
  }
  // Root identity cannot silently migrate to a new symlink target.
  if ("projectId" in scope && canonical !== path.resolve(root))
    throw new FileManagerError("PATH_OUTSIDE_PROJECT", "Authorized root changed");
  const protectedRoot = await realpath(dataDir);
  if (!("projectId" in scope)) {
    const expected =
      key === "workspace:default"
        ? defaultWorkspacePath(protectedRoot)
        : path.join(
            protectedRoot,
            "sessions",
            "sessionId" in scope ? scope.sessionId : "",
            "workspace",
          );
    if (canonical !== expected)
      throw new FileManagerError("PATH_OUTSIDE_PROJECT", "Workspace root changed");
  }
  if ("projectId" in scope && isInsideRoot(protectedRoot, canonical)) {
    throw new FileManagerError("FORBIDDEN", "Larness runtime data is protected");
  }
  return { root: canonical, registeredRoot: root, key, ignore, protectedRoot, scope };
}
export type ResolvedFileScope = Awaited<ReturnType<typeof resolveFileScope>>;
export function assertFileScopeMetadata(db: Database, resolved: ResolvedFileScope) {
  if ("projectId" in resolved.scope) {
    const project = getProjectById(db, resolved.scope.projectId);
    if (!project) throw new FileManagerError("NOT_FOUND", "Project not found");
    if (project.realPath !== resolved.root)
      throw new FileManagerError("PATH_OUTSIDE_PROJECT", "Authorized root changed");
  } else if ("sessionId" in resolved.scope) {
    const session = getSessionById(db, resolved.scope.sessionId);
    if (
      !session ||
      session.projectId !== null ||
      path.resolve(session.workspacePath) !== path.resolve(resolved.registeredRoot)
    )
      throw new FileManagerError("NOT_FOUND", "Standalone workspace not found");
  }
}
export async function authorizeFileTarget(scope: ResolvedFileScope, input: string) {
  const normalized = normalizeFilePath(input);
  const target = await resolveFilePath(scope.root, normalized);
  if ("projectId" in scope.scope && isInsideRoot(scope.protectedRoot, target)) {
    throw new FileManagerError("FORBIDDEN", "Larness runtime data is protected");
  }
  return normalized;
}
