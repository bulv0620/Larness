import { createHash } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { mkdir, readdir, readFile as readFileAsync, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPatch as applyTextPatch, diffLines, parsePatch } from "diff";
import { PathGuardError, resolveInsideRoot } from "./pathGuard.js";

export const MAX_TOOL_OUTPUT_BYTES = 1_048_576;
export const MAX_TOOL_OUTPUT_LINES = 2_000;
export const MAX_READ_BYTES = 1_048_576;
export const MAX_WRITE_BYTES = 1_048_576;
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

export function isIgnoredFile(relativePath: string, name: string, extra: string[]): boolean {
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

      if (isIgnoredFile(relativePath, entry.name, ignore) || entry.isSymbolicLink()) {
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
  /** First line (1-based) included in `content`. */
  offset: number;
  /** Line to pass as the next `offset`; equal to `offset` when nothing follows. */
  nextOffset: number;
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
    offset,
    // Line-based so a caller can always continue; a byte-truncated final line
    // still counts as consumed.
    nextOffset: Math.min(lines.length + 1, offset + selected.length),
  };
}

export interface SearchCodeOptions {
  query: string;
  path?: string;
  limit?: number;
  caseSensitive?: boolean;
  ignore?: string[];
  /** Extra lines around each match, 0-5. */
  contextLines?: number;
  /** Restrict to paths matching a simple glob such as `*.ts` or `src/**`. */
  glob?: string;
  /** Stop after this many files; a scanning budget for large repositories. */
  maxFiles?: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
  /** Context window around the match, joined with newlines, when requested. */
  context?: string;
}

export interface SearchCodeResult {
  matches: SearchMatch[];
  truncated: boolean;
  scannedFiles: number;
  /** True when the file budget stopped the scan before the tree was exhausted. */
  scanBudgetExhausted: boolean;
}

function globToRegExp(glob: string): RegExp {
  let pattern = "";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] ?? "";

    if (char === "*") {
      if (glob[index + 1] === "*" && glob[index + 2] === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else if (glob[index + 1] === "*") {
        pattern += ".*";
        index += 1;
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp(`^${pattern}$`);
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
  const contextLines = Math.min(Math.max(Math.trunc(options.contextLines ?? 0), 0), 5);
  const maxFiles = Math.min(Math.max(Math.trunc(options.maxFiles ?? 2_000), 1), 20_000);
  const globPattern: RegExp | undefined =
    options.glob === undefined ? undefined : globToRegExp(options.glob);
  const matches: SearchMatch[] = [];
  let scannedFiles = 0;
  let truncated = false;
  let scanBudgetExhausted = false;

  const searchFile = async (file: string): Promise<void> => {
    if (truncated || scanBudgetExhausted) {
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

    const relativePath = toPosix(path.relative(rootReal, file));

    if (globPattern !== undefined && !globPattern.test(relativePath)) {
      return;
    }

    scannedFiles += 1;

    if (scannedFiles >= maxFiles) {
      scanBudgetExhausted = true;
    }

    const lines = buffer.toString("utf8").split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const haystack = options.caseSensitive === true ? line : line.toLowerCase();

      if (!haystack.includes(needle)) {
        continue;
      }

      const context =
        contextLines === 0
          ? undefined
          : lines
              .slice(Math.max(0, index - contextLines), index + contextLines + 1)
              .join("\n")
              .slice(0, 2_000);

      matches.push({
        path: relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
        ...(context === undefined ? {} : { context }),
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

    return { matches, truncated, scannedFiles, scanBudgetExhausted };
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

      if (isIgnoredFile(relativePath, entry.name, ignore) || entry.isSymbolicLink()) {
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

  return { matches, truncated, scannedFiles, scanBudgetExhausted };
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

/**
 * Models regularly wrap diffs in code fences, escape newlines twice, or omit
 * the ---/+++ headers. Normalize those shapes before parsing instead of
 * rejecting an otherwise correct diff. Context matching stays exact
 * (fuzzFactor 0); only the envelope is repaired.
 */
export function normalizePatchText(patch: string, filePath: string): string {
  let text = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const fenced = text.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);

  if (fenced !== null && fenced[1] !== undefined) {
    text = fenced[1];
  }

  // Double-escaped payload: no real newline, but literal \n sequences.
  if (!text.includes("\n") && text.includes("\\n")) {
    text = text.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
  }

  // Drop any prose before the first diff line.
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^(--- |\+\+\+ |@@ |diff --git )/.test(line));

  if (start > 0) {
    text = lines.slice(start).join("\n");
  }

  // Synthesize the file headers when only hunks were sent.
  if (/^@@ /m.test(text) && (!/^--- /m.test(text) || !/^\+\+\+ /m.test(text))) {
    text = `--- a/${filePath}\n+++ b/${filePath}\n${text}`;
  }

  return repairHunkEnvelope(text);
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

/**
 * The model often miscounts `@@ -a,b +c,d @@`, drops the leading space of a
 * context line, or sends a blank line where a context line belongs. The body
 * is authoritative: recompute the counts from it and prefix bare lines as
 * context. Application still matches context exactly (fuzzFactor 0), so a
 * wrong repair fails closed instead of writing a different file.
 */
function repairHunkEnvelope(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const header = HUNK_HEADER.exec(line);

    if (header === null) {
      output.push(line);
      index += 1;
      continue;
    }

    const oldStart = header[1] ?? "0";
    const newStart = header[3] ?? "0";
    const tail = header[5] ?? "";
    index += 1;
    const body: string[] = [];
    let oldLines = 0;
    let newLines = 0;

    while (index < lines.length) {
      const bodyLine = lines[index] ?? "";

      if (
        bodyLine.startsWith("@@ ") ||
        bodyLine.startsWith("diff --git ") ||
        bodyLine.startsWith("Index: ")
      ) {
        break;
      }

      if (bodyLine.startsWith("\\ No newline")) {
        body.push(bodyLine);
        index += 1;
        continue;
      }

      if (bodyLine.length === 0) {
        // The trailing empty element is the artifact of a patch ending in "\n".
        if (index === lines.length - 1) {
          index += 1;
          break;
        }

        body.push(" ");
        oldLines += 1;
        newLines += 1;
        index += 1;
        continue;
      }

      const marker = bodyLine[0];

      if (marker === "+") {
        body.push(bodyLine);
        newLines += 1;
      } else if (marker === "-") {
        body.push(bodyLine);
        oldLines += 1;
      } else if (marker === " ") {
        body.push(bodyLine);
        oldLines += 1;
        newLines += 1;
      } else {
        body.push(` ${bodyLine}`);
        oldLines += 1;
        newLines += 1;
      }

      index += 1;
    }

    if (body.length === 0) {
      // Nothing to measure: keep the original header so the parser reports it.
      output.push(line);
      continue;
    }

    output.push(`@@ -${oldStart},${oldLines} +${newStart},${newLines} @@${tail}`, ...body);
  }

  return output.join("\n");
}

function diagnosePatch(text: string, error: unknown): string {
  if (!/^@@ /m.test(text)) {
    return "missing @@ hunk header";
  }

  if (!/^--- /m.test(text) || !/^\+\+\+ /m.test(text)) {
    return "missing ---/+++ file headers";
  }

  const message = error instanceof Error ? error.message : "";

  return message.trim().slice(0, 160) || "unrecognized diff format";
}

export interface CreateTextFileResult {
  path: string;
  version: string;
  bytes: number;
  lines: number;
  created: true;
}

export async function createTextFile(
  rootReal: string,
  options: { path: string; content: string },
): Promise<CreateTextFileResult> {
  if (options.content.includes("\0")) {
    throw new FileError("VALIDATION_ERROR", "content must be text");
  }

  const bytes = Buffer.byteLength(options.content, "utf8");

  if (bytes > MAX_WRITE_BYTES) {
    throw new FileError("TOO_LARGE", `content exceeds ${MAX_WRITE_BYTES} bytes`, { bytes });
  }

  const target = await resolveInput(rootReal, options.path);
  await mkdir(path.dirname(target), { recursive: true });

  try {
    // `wx` keeps this create-only: existing files must be changed via apply_patch.
    await writeFile(target, options.content, { encoding: "utf8", flag: "wx", mode: 0o644 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "EEXIST") {
      const existing = await readFileAsync(target);

      throw new FileError(
        "VERSION_CONFLICT",
        "file already exists; read it and use apply_patch to change it",
        { currentVersion: hashContent(existing) },
      );
    }

    throw new FileError("INTERNAL", `cannot write file: ${code ?? "unknown"}`);
  }

  const buffer = await readFileAsync(target);

  return {
    path: toPosix(path.relative(rootReal, target)),
    version: hashContent(buffer),
    bytes,
    lines: options.content.split("\n").length,
    created: true,
  };
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
  const normalized = normalizePatchText(options.patch, options.path);

  try {
    const parsedPatches = parsePatch(normalized);

    if (parsedPatches.length === 0 || parsedPatches.every((parsed) => parsed.hunks.length === 0)) {
      throw new FileError(
        "INVALID_PATCH",
        `patch has no hunks: ${diagnosePatch(normalized, undefined)}`,
      );
    }
  } catch (error) {
    if (error instanceof FileError) {
      throw error;
    }

    throw new FileError(
      "INVALID_PATCH",
      `patch could not be parsed: ${diagnosePatch(normalized, error)}`,
    );
  }

  let patched: string | false;

  try {
    patched = applyTextPatch(original, normalized, { fuzzFactor: 0 });
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
