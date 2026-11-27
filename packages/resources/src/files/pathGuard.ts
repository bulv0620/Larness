import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type PathGuardErrorCode =
  | "INVALID_PATH"
  | "NOT_FOUND"
  | "PATH_OUTSIDE_PROJECT"
  | "FORBIDDEN";

export class PathGuardError extends Error {
  readonly code: PathGuardErrorCode;

  constructor(code: PathGuardErrorCode, message: string) {
    super(message);
    this.name = "PathGuardError";
    this.code = code;
  }
}

function validateInput(input: string): void {
  if (input.trim().length === 0 || input.includes("\0")) {
    throw new PathGuardError("INVALID_PATH", "path must be non-empty and must not contain NUL");
  }
}

export function isInsideRoot(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

export function assertInsideRoot(rootReal: string, candidateReal: string): string {
  if (!isInsideRoot(rootReal, candidateReal)) {
    throw new PathGuardError("PATH_OUTSIDE_PROJECT", "path escapes the authorized project root");
  }

  return candidateReal;
}

export async function canonicalDirectory(input: string): Promise<string> {
  validateInput(input);

  let resolved: string;

  try {
    resolved = await realpath(input);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new PathGuardError(
      code === "ENOENT" ? "NOT_FOUND" : "INVALID_PATH",
      `cannot resolve directory: ${code ?? "unknown"}`,
    );
  }

  const info = await stat(resolved);

  if (!info.isDirectory()) {
    throw new PathGuardError("INVALID_PATH", "path is not a directory");
  }

  try {
    await access(resolved, constants.R_OK);
  } catch {
    throw new PathGuardError("INVALID_PATH", "directory is not readable");
  }

  return resolved;
}

export async function resolveInsideRoot(rootReal: string, input: string): Promise<string> {
  validateInput(input);

  if (!path.isAbsolute(rootReal)) {
    throw new PathGuardError("INVALID_PATH", "project root must be absolute");
  }

  const absolute = path.isAbsolute(input) ? path.normalize(input) : path.resolve(rootReal, input);

  return assertInsideRoot(rootReal, await resolveCanonicalPath(absolute));
}

/**
 * Resolve a path to its canonical form even when it lives outside the primary
 * root: realpath the nearest existing ancestor and re-append the missing tail.
 */
export async function resolveCanonicalPath(input: string): Promise<string> {
  validateInput(input);

  const absolute = path.isAbsolute(input) ? path.normalize(input) : path.resolve(input);
  const missing: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const existing = await realpath(current);
      return path.join(existing, ...missing);
    } catch (error) {
      if (!(error instanceof PathGuardError)) {
        const code = (error as NodeJS.ErrnoException).code;

        if (code !== "ENOENT") {
          throw new PathGuardError("INVALID_PATH", `cannot resolve path: ${code ?? "unknown"}`);
        }
      } else {
        throw error;
      }
    }

    const parent = path.dirname(current);

    if (parent === current) {
      throw new PathGuardError("INVALID_PATH", "path cannot be resolved");
    }

    missing.unshift(path.basename(current));
    current = parent;
  }
}

export type RootScope = "primary" | "external";

export interface ReadPathPolicy {
  /** Primary root: relative inputs resolve here and must stay inside. */
  root: string;
  /** Allow canonical absolute inputs outside `root`. Defaults to false. */
  allowExternal?: boolean;
  /** Canonical directories that are always rejected (for example `<dataDir>`). */
  protectedRoots?: readonly string[];
}

export interface ResolvedReadPath {
  /** Canonical target: realpath of the nearest existing ancestor plus any missing tail. */
  absolutePath: string;
  rootScope: RootScope;
}

/** POSIX pseudo filesystems whose entries can block or grow without bound. */
const PSEUDO_FILESYSTEM_ROOTS = ["/proc", "/sys", "/dev"] as const;

async function homeRealPath(): Promise<string> {
  const home = os.homedir();

  try {
    return await realpath(home);
  } catch {
    return path.resolve(home);
  }
}

/**
 * Read-side resolver. Relative inputs keep the old "inside the root" rule;
 * absolute inputs may escape the root only when `allowExternal` is true, and
 * always fail closed on `<dataDir>`, pseudo filesystems and root-level targets.
 */
export async function resolveReadPath(
  policy: ReadPathPolicy,
  input: string,
): Promise<ResolvedReadPath> {
  validateInput(input);

  if (!path.isAbsolute(policy.root)) {
    throw new PathGuardError("INVALID_PATH", "project root must be absolute");
  }

  if (!path.isAbsolute(input)) {
    return {
      absolutePath: await resolveInsideRoot(policy.root, input),
      rootScope: "primary",
    };
  }

  if (policy.allowExternal !== true) {
    return {
      absolutePath: await resolveInsideRoot(policy.root, input),
      rootScope: "primary",
    };
  }

  const normalized = path.normalize(input);

  if (path.parse(normalized).root === normalized) {
    throw new PathGuardError(
      "INVALID_PATH",
      "specify a directory below the filesystem root instead of the root itself",
    );
  }

  const absolutePath = await resolveCanonicalPath(normalized);

  if (absolutePath === (await homeRealPath())) {
    throw new PathGuardError(
      "INVALID_PATH",
      "specify a directory below the home directory instead of the home directory itself",
    );
  }

  if (process.platform !== "win32") {
    for (const pseudoRoot of PSEUDO_FILESYSTEM_ROOTS) {
      if (isInsideRoot(pseudoRoot, absolutePath)) {
        throw new PathGuardError("FORBIDDEN", `pseudo filesystem is not readable: ${pseudoRoot}`);
      }
    }
  }

  for (const protectedRoot of policy.protectedRoots ?? []) {
    if (isInsideRoot(protectedRoot, absolutePath)) {
      throw new PathGuardError("FORBIDDEN", "path is inside a protected Larness directory");
    }
  }

  return {
    absolutePath,
    rootScope: isInsideRoot(policy.root, absolutePath) ? "primary" : "external",
  };
}
