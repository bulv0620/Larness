import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { readdir, readFile as readFileAsync, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyTextPatch, diffLines, parsePatch } from "diff";
import { PathGuardError, resolveInsideRoot } from "./pathGuard.js";

export const MAX_TOOL_OUTPUT_BYTES = 1_048_576;
export const MAX_TOOL_OUTPUT_LINES = 2_000;
export const MAX_READ_BYTES = 1_048_576;
export const MAX_SEARCH_FILE_BYTES = 262_144;

const DEFAULT_IGNORED = new Set([".git", "node_modules", ".larness"]);

export type FileErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "PATH_OUTSIDE_PROJECT"
  | "VERSION_CONFLICT"
  | "TOO_LARGE"
  | "INVALID_PATCH"
  | "INTERNAL";

export class FileError extends Error {
  readonly code: FileErrorCode;
  readonly details?: unknown;

  constructor(code: FileErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "FileError";
    this.code = code;
    this.details = details;
  }
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

function fromPosix(relative: string): string {
  return relative.split("/").join(path.sep);
}

function ignored(relativePath: string, name: string, extra: string[]): boolean {
  if (DEFAULT_IGNORED.has(name)) {
    return true;
  }

  return extra.some((raw) => {
    const pattern = raw
      .trim()
      .replace(/^\.?\/+/, "")
      .replace(/\/+$/, "");

    if (pattern.length === 0) {
      return false;
    }

    if (pattern.includes("/")) {
      return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
    }

    return name === pattern;
  });
}

function assertNotBinary(buffer: Buffer, displayPath: string): void {
  if (buffer.includes(0)) {
    throw new FileError("VALIDATION_ERROR", `file is not text: ${displayPath}`);
  }
}

function mapPathError(error: unknown): never {
  if (error instanceof PathGuardError) {
    if (error.code === "NOT_FOUND") {
      throw new FileError("NOT_FOUND", error.message);
    }

    if (error.code === "PATH_OUTSIDE_PROJECT") {
      throw new FileError("PATH_OUTSIDE_PROJECT", error.message);
    }

    throw new FileError("VALIDATION_ERROR", error.message);
  }

  throw error;
}

function mapFsError(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ENOENT") {
    throw new FileError("NOT_FOUND", "path not found");
  }

  if (code === "EACCES" || code === "EPERM" || code === "ENOTDIR" || code === "EISDIR") {
    throw new FileError("VALIDATION_ERROR", `path is not accessible: ${code}`);
  }

  throw new FileError("INTERNAL", `file operation failed: ${code ?? "unknown"}`);
}

async function statOrThrow(target: string): Promise<Stats> {
  try {
    return await stat(target);
  } catch (error) {
    mapFsError(error);
  }
}

async function readFileOrThrow(target: string): Promise<Buffer> {
  try {
    return await readFileAsync(target);
  } catch (error) {
    mapFsError(error);
  }
}

async function readDirOrThrow(dir: string, options: { withFileTypes: true }): Promise<Dirent[]> {
  try {
    return (await readdir(dir, options)) as Dirent[];
  } catch (error) {
    mapFsError(error);
  }
}

async function writeFileOrThrow(target: string, content: string): Promise<void> {
  try {
    await writeFile(target, content, "utf8");
  } catch (error) {
    mapFsError(error);
  }
}

async function resolveInput(rootReal: string, input: string): Promise<string> {
  try {
    return await resolveInsideRoot(rootReal, fromPosix(input));
  } catch (error) {
    mapPathError(error);
  }
}

export interface FileEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
}

export interface ListFilesOptions {
  path?: string;
  depth?: number;
  limit?: number;
  ignore?: string[];
}

export interface ListFilesResult {
  files: FileEntry[];
  truncated: boolean;
}

export async function listFiles(
  rootReal: string,
  options: ListFilesOptions = {},
): Promise<ListFilesResult> {
  const base = await resolveInput(rootReal, options.path ?? ".");
  const baseInfo = await statOrThrow(base);

  if (!baseInfo.isDirectory()) {
    throw new FileError("VALIDATION_ERROR", "path is not a directory");
  }

  const depth = Math.min(Math.max(Math.trunc(options.depth ?? 3), 1), 10);
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 2_000);
  const ignore = options.ignore ?? [];
  const files: FileEntry[] = [];
  let truncated = false;

  const walk = async (dir: string, level: number): Promise<void> => {
    if (truncated) {
      return;
    }

    const entries = await readDirOrThrow(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      const absolute = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(rootReal, absolute));

      if (ignored(relativePath, entry.name, ignore) || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        files.push({ path: relativePath, name: entry.name, type: "directory" });

        if (files.length > limit) {
          truncated = true;
          return;
        }

        if (level < depth) {
          await walk(absolute, level + 1);
        }
      } else if (entry.isFile()) {
        const info = await statOrThrow(absolute);
        files.push({
          path: relativePath,
          name: entry.name,
          type: "file",
          size: info.size,
        });

        if (files.length > limit) {
          truncated = true;
          return;
        }
      }
    }
  };

  await walk(base, 1);

  if (files.length > limit) {
    files.pop();
    truncated = true;
  }

  return { files, truncated };
}

export interface ReadFileOptions {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadFileResult {
  path: string;
  version: string;
  content: string;
  truncated: boolean;
  totalLines: number;
}

export function hashContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function readTextFile(
  rootReal: string,
  options: ReadFileOptions,
): Promise<ReadFileResult> {
  const target = await resolveInput(rootReal, options.path);
  const info = await statOrThrow(target);

  if (!info.isFile()) {
    throw new FileError("VALIDATION_ERROR", "path is not a file");
  }

  if (info.size > MAX_READ_BYTES) {
    throw new FileError("TOO_LARGE", `file exceeds ${MAX_READ_BYTES} bytes`, {
      size: info.size,
    });
  }

  const buffer = await readFileOrThrow(target);
  const version = hashContent(buffer);
  assertNotBinary(buffer, options.path);

  const lines = buffer.toString("utf8").split(/\r?\n/);
  const offset = Math.max(Math.trunc(options.offset ?? 1), 1);
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? MAX_TOOL_OUTPUT_LINES), 1),
    MAX_TOOL_OUTPUT_LINES,
  );
  const selected = lines.slice(offset - 1, offset - 1 + limit);
  const content = selected.join("\n");
  const byteLength = Buffer.byteLength(content, "utf8");
  const truncated =
    offset - 1 + selected.length < lines.length || byteLength > MAX_TOOL_OUTPUT_BYTES;

  return {
    path: toPosix(path.relative(rootReal, target)),
    version,
    content:
      byteLength > MAX_TOOL_OUTPUT_BYTES
        ? Buffer.from(content, "utf8").subarray(0, MAX_TOOL_OUTPUT_BYTES).toString("utf8")
        : content,
    truncated,
    totalLines: lines.length,
  };
}

export interface SearchCodeOptions {
  query: string;
  path?: string;
  limit?: number;
  caseSensitive?: boolean;
  ignore?: string[];
}

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

export interface SearchCodeResult {
  matches: SearchMatch[];
  truncated: boolean;
  scannedFiles: number;
}

export async function searchCode(
  rootReal: string,
  options: SearchCodeOptions,
): Promise<SearchCodeResult> {
  const query = options.query.trim();

  if (query.length === 0 || query.length > 500) {
    throw new FileError("VALIDATION_ERROR", "query must be 1-500 characters");
  }

  const base = await resolveInput(rootReal, options.path ?? ".");
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 500);
  const ignore = options.ignore ?? [];
  const needle = options.caseSensitive === true ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  let scannedFiles = 0;
  let truncated = false;

  const searchFile = async (file: string): Promise<void> => {
    if (truncated) {
      return;
    }

    const info = await statOrThrow(file);

    if (!info.isFile() || info.size > MAX_SEARCH_FILE_BYTES) {
      return;
    }

    const buffer = await readFileOrThrow(file);

    if (buffer.includes(0)) {
      return;
    }

    scannedFiles += 1;
    const lines = buffer.toString("utf8").split(/\r?\n/);
    const relativePath = toPosix(path.relative(rootReal, file));

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const haystack = options.caseSensitive === true ? line : line.toLowerCase();

      if (!haystack.includes(needle)) {
        continue;
      }

      matches.push({
        path: relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
      });

      if (matches.length > limit) {
        truncated = true;
        return;
      }
    }
  };

  const baseInfo = await statOrThrow(base);

  if (baseInfo.isFile()) {
    await searchFile(base);

    if (matches.length > limit) {
      matches.pop();
      truncated = true;
    }

    return { matches, truncated, scannedFiles };
  }

  const walk = async (dir: string): Promise<void> => {
    if (truncated) {
      return;
    }

    const entries = await readDirOrThrow(dir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      const absolute = path.join(dir, entry.name);
      const relativePath = toPosix(path.relative(rootReal, absolute));

      if (ignored(relativePath, entry.name, ignore) || entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        await searchFile(absolute);
      }
    }
  };

  await walk(base);

  if (matches.length > limit) {
    matches.pop();
    truncated = true;
  }

  return { matches, truncated, scannedFiles };
}

export interface ApplyPatchOptions {
  path: string;
  expectedVersion: string;
  patch: string;
}

export interface ApplyPatchResult {
  path: string;
  version: string;
  previousVersion: string;
  additions: number;
  deletions: number;
}

export async function applyPatch(
  rootReal: string,
  options: ApplyPatchOptions,
): Promise<ApplyPatchResult> {
  if (options.expectedVersion.trim().length === 0) {
    throw new FileError("VALIDATION_ERROR", "expectedVersion is required");
  }

  if (options.patch.trim().length === 0) {
    throw new FileError("VALIDATION_ERROR", "patch must not be empty");
  }

  const target = await resolveInput(rootReal, options.path);
  const info = await statOrThrow(target);

  if (!info.isFile()) {
    throw new FileError("VALIDATION_ERROR", "path is not a file");
  }

  const originalBuffer = await readFileOrThrow(target);

  if (originalBuffer.includes(0)) {
    throw new FileError("VALIDATION_ERROR", "file is not text");
  }

  const previousVersion = hashContent(originalBuffer);

  if (previousVersion !== options.expectedVersion) {
    throw new FileError("VERSION_CONFLICT", "file version does not match", {
      currentVersion: previousVersion,
    });
  }

  const original = originalBuffer.toString("utf8");

  try {
    const parsedPatches = parsePatch(options.patch);

    if (parsedPatches.length === 0 || parsedPatches.every((parsed) => parsed.hunks.length === 0)) {
      throw new FileError("INVALID_PATCH", "patch has no hunks");
    }
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }

    throw new FileError("INVALID_PATCH", "patch could not be parsed");
  }

  let patched: string | false;

  try {
    patched = applyTextPatch(original, options.patch, { fuzzFactor: 0 });
  } catch {
    throw new FileError("INVALID_PATCH", "patch could not be applied");
  }

  if (patched === false) {
    throw new FileError("INVALID_PATCH", "patch does not match the file");
  }

  const currentBuffer = await readFileOrThrow(target);

  if (hashContent(currentBuffer) !== previousVersion) {
    throw new FileError("VERSION_CONFLICT", "file changed while applying the patch", {
      currentVersion: hashContent(currentBuffer),
    });
  }

  const changes = diffLines(original, patched, { newlineIsToken: false });
  let additions = 0;
  let deletions = 0;

  for (const change of changes) {
    if (change.added === true) {
      additions += change.count ?? 0;
    } else if (change.removed === true) {
      deletions += change.count ?? 0;
    }
  }

  await writeFileOrThrow(target, patched);

  return {
    path: toPosix(path.relative(rootReal, target)),
    version: hashContent(Buffer.from(patched, "utf8")),
    previousVersion,
    additions,
    deletions,
  };
}
