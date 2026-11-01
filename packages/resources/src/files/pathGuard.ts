import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type PathGuardErrorCode = "INVALID_PATH" | "NOT_FOUND" | "PATH_OUTSIDE_PROJECT";

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
  const missing: string[] = [];
  let current = absolute;

  for (;;) {
    try {
      const existing = await realpath(current);
      const candidate = path.join(existing, ...missing);
      return assertInsideRoot(rootReal, candidate);
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
