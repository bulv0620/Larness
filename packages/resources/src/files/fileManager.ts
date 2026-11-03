import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  type ErrorCode,
  FilePathSchema,
  type FileReadResult,
  MAX_EDITABLE_FILE_BYTES,
} from "@larness/shared";
import { z } from "zod";
import { hashContent, isIgnoredFile } from "./fileService.js";
import { isInsideRoot } from "./pathGuard.js";

export class FileManagerError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: { currentVersion: string },
    readonly requiresReconciliation = false,
  ) {
    super(message);
    this.name = "FileManagerError";
  }
}
function reject(code: ErrorCode, message: string): never {
  throw new FileManagerError(code, message);
}
function filesystemError(error: unknown): never {
  if (error instanceof FileManagerError) throw error;
  const code = z.object({ code: z.string() }).safeParse(error);
  if (code.success && ["ENOENT", "ENOTDIR"].includes(code.data.code))
    reject("NOT_FOUND", "File is unavailable");
  if (code.success && ["EACCES", "EPERM", "ELOOP"].includes(code.data.code))
    reject("FORBIDDEN", "File access denied");
  reject("INTERNAL", "File operation failed");
}
export function normalizeFilePath(value: string) {
  const parsed = FilePathSchema.safeParse(value);
  if (!parsed.success) reject("VALIDATION_ERROR", "Invalid relative file path");
  const parts = parsed.data.split("/").filter((item) => item && item !== ".");
  if (
    parts.some(
      (part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) || /[. ]$/.test(part),
    )
  ) {
    reject("VALIDATION_ERROR", "Unsupported file path");
  }
  return parts.join("/") || ".";
}

export async function resolveFilePath(root: string, relative: string): Promise<string> {
  try {
    const normalized = normalizeFilePath(relative);
    if ((await realpath(root)) !== root) reject("PATH_OUTSIDE_PROJECT", "Authorized root changed");
    let target = root;
    for (const part of normalized === "." ? [] : normalized.split("/")) {
      target = path.join(target, part);
      if ((await lstat(target)).isSymbolicLink())
        reject("PATH_OUTSIDE_PROJECT", "Symbolic link access denied");
    }
    if (!isInsideRoot(root, await realpath(target)))
      reject("PATH_OUTSIDE_PROJECT", "Path outside authorized root");
    return target;
  } catch (error) {
    filesystemError(error);
  }
}

export function encodeEditableContent(content: string): Buffer {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_EDITABLE_FILE_BYTES)
    reject("PAYLOAD_TOO_LARGE", "File exceeds editing limit");
  if (bytes.includes(0)) reject("FILE_NOT_EDITABLE", "File is not UTF-8 text");
  try {
    if (new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== content) {
      reject("FILE_NOT_EDITABLE", "Invalid UTF-8 text");
    }
  } catch {
    reject("FILE_NOT_EDITABLE", "Invalid UTF-8 text");
  }
  return bytes;
}

export async function readEditableFile(
  root: string,
  relative: string,
  afterOpen?: () => Promise<void>,
) {
  try {
    const normalized = normalizeFilePath(relative);
    const target = await resolveFilePath(root, normalized);
    if (!(await lstat(target)).isFile())
      reject("FILE_NOT_EDITABLE", "Only regular files are editable");
    const fd = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await fd.stat();
      if (!before.isFile()) reject("FILE_NOT_EDITABLE", "Only regular files are editable");
      if (before.size > MAX_EDITABLE_FILE_BYTES)
        reject("PAYLOAD_TOO_LARGE", "File exceeds editing limit");
      await afterOpen?.();
      const bytes = Buffer.alloc(MAX_EDITABLE_FILE_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const read = await fd.read(bytes, size, bytes.length - size, size);
        if (read.bytesRead === 0) break;
        size += read.bytesRead;
      }
      if (size > MAX_EDITABLE_FILE_BYTES) reject("PAYLOAD_TOO_LARGE", "File exceeds editing limit");
      const snapshot = await stat(await resolveFilePath(root, normalized));
      const after = await fd.stat();
      if (
        snapshot.ino !== before.ino ||
        snapshot.dev !== before.dev ||
        snapshot.size !== size ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs
      )
        reject("CONFLICT", "File identity changed while reading");
      const buffer = bytes.subarray(0, size);
      if (buffer.includes(0)) reject("FILE_NOT_EDITABLE", "File is not UTF-8 text");
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
      } catch {
        reject("FILE_NOT_EDITABLE", "File is not UTF-8 text");
      }
      return {
        path: normalized,
        realPath: target,
        content,
        version: hashContent(buffer),
        size,
        encoding: "utf-8" as const,
        inode: before.ino,
        device: before.dev,
        mode: before.mode,
        mtime: before.mtimeMs,
      };
    } finally {
      await fd.close();
    }
  } catch (error) {
    filesystemError(error);
  }
}

export async function saveEditableFile(
  root: string,
  input: { path: string; content: string; expectedVersion: string },
  hooks: {
    beforeCommit: () => void | Promise<void>;
    assertFence?: () => void;
    onReplaced?: () => void;
    temporaryName?: string;
  },
): Promise<FileReadResult> {
  const bytes = encodeEditableContent(input.content);
  const original = await readEditableFile(root, input.path);
  if (original.version !== input.expectedVersion)
    throw new FileManagerError("VERSION_CONFLICT", "File version changed", {
      currentVersion: original.version,
    });
  const name = hooks.temporaryName ?? `.larness-save-${randomUUID()}`;
  if (!/^\.larness-save-[a-zA-Z0-9_-]+$/.test(name))
    reject("INTERNAL", "Invalid save operation identity");
  const temporary = path.join(path.dirname(original.realPath), name);
  let result: FileReadResult | undefined;
  let failed = false;
  let failure: unknown;
  let temporaryCreated = false;
  let temporaryIdentity: { ino: number; dev: number } | undefined;
  try {
    hooks.assertFence?.();
    const fd = await open(temporary, "wx", 0o600);
    temporaryCreated = true;
    try {
      temporaryIdentity = await fd.stat();
      hooks.assertFence?.();
      await fd.writeFile(bytes);
      await fd.chmod(original.mode & 0o777);
      await fd.sync();
    } finally {
      await fd.close();
    }
    await hooks.beforeCommit();
    const current = await readEditableFile(root, input.path);
    if (current.version !== original.version)
      throw new FileManagerError("VERSION_CONFLICT", "File version changed", {
        currentVersion: current.version,
      });
    if (current.inode !== original.inode || current.device !== original.device)
      reject("CONFLICT", "File identity changed");
    // No awaits between the final authorization/fence check and rename dispatch.
    hooks.assertFence?.();
    await rename(temporary, original.realPath);
    hooks.onReplaced?.();
    result = {
      path: original.path,
      realPath: original.realPath,
      content: input.content,
      version: hashContent(bytes),
      size: bytes.length,
      encoding: "utf-8",
    };
  } catch (error) {
    failed = true;
    failure = error;
  }
  try {
    if (temporaryCreated) {
      const current = await lstat(temporary);
      if (
        !temporaryIdentity ||
        current.ino !== temporaryIdentity.ino ||
        current.dev !== temporaryIdentity.dev
      ) {
        reject("RESOURCE_UNAVAILABLE", "Temporary save identity changed");
      }
      await rm(temporary);
    }
  } catch (error) {
    if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success) {
      throw new FileManagerError(
        "RESOURCE_UNAVAILABLE",
        "File save cleanup requires reconciliation",
        undefined,
        true,
      );
    }
  }
  if (failed) filesystemError(failure);
  if (!result) reject("INTERNAL", "File save did not produce a result");
  return result;
}

const CursorSchema = z
  .object({ directory: z.string(), revision: z.string(), offset: z.number().int().nonnegative() })
  .strict();
export async function listDirectory(
  root: string,
  input: {
    path: string;
    limit: number;
    cursor?: string;
    ignore?: string[];
    exclude?: (target: string) => boolean;
  },
) {
  try {
    const relative = normalizeFilePath(input.path);
    const target = await resolveFilePath(root, relative);
    if (!(await stat(target)).isDirectory()) reject("VALIDATION_ERROR", "Expected directory");
    const identity = await stat(target);
    const entries: { name: string; path: string; type: "file" | "directory"; size?: number }[] = [];
    const stamps: unknown[] = [];
    for (const entry of await readdir(target, { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      if (
        (!entry.isFile() && !entry.isDirectory()) ||
        isIgnoredFile(file, entry.name, input.ignore ?? [])
      )
        continue;
      if (input.exclude?.(path.join(target, entry.name))) continue;
      const resolved = await resolveFilePath(root, file);
      const info = await lstat(resolved);
      const type = info.isDirectory() ? "directory" : info.isFile() ? "file" : null;
      if (type === null) continue;
      entries.push({
        name: entry.name,
        path: file,
        type,
        ...(type === "file" ? { size: info.size } : {}),
      });
      stamps.push([file, info.ino, info.size, info.mtimeMs]);
    }
    const after = await stat(await resolveFilePath(root, relative));
    if (
      identity.ino !== after.ino ||
      identity.dev !== after.dev ||
      identity.mtimeMs !== after.mtimeMs
    )
      reject("CONFLICT", "Directory changed during listing");
    entries.sort(
      (a, b) =>
        (a.type === b.type ? 0 : a.type === "directory" ? -1 : 1) || a.name.localeCompare(b.name),
    );
    const revision = hashContent(Buffer.from(JSON.stringify(stamps.sort())));
    const directory = hashContent(Buffer.from(target));
    let offset = 0;
    if (input.cursor) {
      let cursor: z.infer<typeof CursorSchema>;
      try {
        cursor = CursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        );
      } catch {
        reject("VALIDATION_ERROR", "Invalid file cursor");
      }
      if (
        cursor.directory !== directory ||
        cursor.revision !== revision ||
        cursor.offset > entries.length
      )
        reject("CONFLICT", "Directory snapshot changed");
      offset = cursor.offset;
    }
    const end = offset + input.limit;
    return {
      items: entries.slice(offset, end),
      revision,
      nextCursor:
        end < entries.length
          ? Buffer.from(JSON.stringify({ directory, revision, offset: end })).toString("base64url")
          : null,
    };
  } catch (error) {
    filesystemError(error);
  }
}
