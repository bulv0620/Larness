import { link, lstat, mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import {
  FileManagerError,
  hashContent,
  isIgnoredFile,
  isInsideRoot,
  normalizeFilePath,
  readEditableFile,
} from "@larness/resources";
import {
  ERROR_CODES,
  type FileAction,
  type FileActionResult,
  FileActionResultSchema,
  FilePathSchema,
} from "@larness/shared";
import { z } from "zod";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ResourceOperationRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { ProjectWriteLock } from "../agent/projectWriteLock.js";
import { releaseResourceLock } from "../locks/service.js";
import {
  appendResourceEvent,
  deleteCachedFile,
  findOperation,
  insertOperation,
  pendingOperations,
  updateOperation,
} from "../resources/repository.js";
import {
  assertFileScopeMetadata,
  authorizeFileTarget,
  type ResolvedFileScope,
  resolveFileScope,
} from "./scope.js";
import type { FileServiceOptions } from "./service.js";

const kind = "file.action";
const intentSchema = z.object({
  action: z.enum(["createFile", "createDirectory", "move"]),
  target: FilePathSchema,
  identity: z.string().optional(),
});

function fail(code: ConstructorParameters<typeof FileManagerError>[0], message: string): never {
  throw new FileManagerError(code, message);
}

function errorCode(error: unknown) {
  return z.object({ code: z.string() }).safeParse(error).data?.code;
}

async function destinationPath(scope: ResolvedFileScope, relative: string) {
  if (relative === ".") fail("VALIDATION_ERROR", "Expected a file or directory name");
  const parent = await authorizeFileTarget(scope, path.posix.dirname(relative));
  const absolute = path.join(scope.root, parent, path.posix.basename(relative));
  if ("projectId" in scope.scope && isInsideRoot(scope.protectedRoot, absolute))
    fail("FORBIDDEN", "Larness runtime data is protected");
  return absolute;
}

async function snapshot(absolute: string) {
  try {
    return await lstat(absolute, { bigint: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

type Snapshot = Awaited<ReturnType<typeof snapshot>>;
function identity(info: Snapshot): string | undefined {
  return info?.isFile() ? `${info.dev}:${info.ino}` : undefined;
}

function replay(operation: ResourceOperationRow, digest: string) {
  if (operation.paramsHash !== digest)
    fail("CONFLICT", "Idempotency key belongs to another request");
  if (operation.status === "COMPLETED")
    return FileActionResultSchema.parse(JSON.parse(operation.resultJson ?? "null"));
  if (operation.status === "FAILED") {
    const code = z.enum(ERROR_CODES).safeParse(operation.errorCode);
    fail(code.data ?? "INTERNAL", "Previous file operation failed");
  }
  return fail("RESOURCE_UNAVAILABLE", "File operation awaits reconciliation");
}

function complete(
  options: FileServiceOptions,
  operation: ResourceOperationRow,
  result: FileActionResult,
) {
  const now = options.now?.() ?? Date.now();
  const events = immediateTransaction(options.db, (tx) => {
    const event = (path: string, changeType: "created" | "deleted") =>
      appendResourceEvent(
        tx,
        `file:${operation.scopeKey}`,
        "file.changed",
        { path, changeType },
        now,
      );
    const events = result.previousPath ? [event(result.previousPath, "deleted")] : [];
    if (result.previousPath) deleteCachedFile(tx, operation.scopeKey, result.previousPath);
    deleteCachedFile(tx, operation.scopeKey, result.path);
    events.push(event(result.path, "created"));
    updateOperation(tx, operation.id, {
      status: "COMPLETED",
      resultJson: JSON.stringify(result),
      errorCode: null,
      updatedAt: now,
    });
    appendAudit(tx, {
      action: "file.action.completed",
      decision: "allow",
      clientSessionId: operation.clientSessionId,
      resourceType: "file",
      resourceId: operation.id,
      details: { scope: operation.scopeKey },
      now,
    });
    return events;
  });
  for (const event of events) {
    try {
      options.publish?.(event);
    } catch {
      // The persisted events remain available to clients through replay.
    }
  }
}

export async function applyFileAction(
  options: FileServiceOptions,
  input: FileAction,
  clientSessionId: string,
  idempotencyKey: string,
) {
  const resolved = await resolveFileScope(options.db, options.dataDir, input.scope);
  const source = normalizeFilePath(input.path);
  const target = input.action === "move" ? normalizeFilePath(input.destination) : source;
  const expectedVersion = input.action === "move" ? input.expectedVersion : "";
  options.assertContent?.(source);
  options.assertContent?.(target);
  if (
    target
      .split("/")
      .some((name, index, parts) =>
        isIgnoredFile(parts.slice(0, index + 1).join("/"), name, resolved.ignore),
      )
  )
    fail("VALIDATION_ERROR", "Destination is hidden by the file tree settings");
  const digest = hashContent(
    Buffer.from(JSON.stringify([resolved.key, input.action, source, target, expectedVersion])),
  );
  const prior = findOperation(options.db, clientSessionId, idempotencyKey, kind);
  options.assertClient?.();
  if (prior) return replay(prior, digest);
  const id = newId("op");
  const lock = new ProjectWriteLock({
    db: options.db,
    projectId: "projectId" in resolved.scope ? resolved.scope.projectId : resolved.key,
    rootRealPath: resolved.root,
    owner: clientSessionId,
    executionId: id,
    now: options.now,
  });
  const now = options.now ?? Date.now;
  const intent = { action: input.action, target, identity: undefined as string | undefined };
  const operation = immediateTransaction(options.db, (tx) => {
    options.assertClient?.();
    assertFileScopeMetadata(options.db, resolved);
    const duplicate = findOperation(tx, clientSessionId, idempotencyKey, kind);
    if (duplicate) return duplicate;
    const handle = lock.acquire();
    if (!handle) fail("RESOURCE_LOCKED", "Authorized root has an active writer");
    const timestamp = now();
    const row: ResourceOperationRow = {
      id,
      kind,
      scopeKey: resolved.key,
      rootRealPath: resolved.root,
      status: "PREPARED",
      paramsHash: digest,
      idempotencyKey,
      clientSessionId,
      path: source,
      expectedVersion,
      targetVersion: "",
      lockId: handle.id,
      fencingToken: handle.fencingToken,
      resultJson: JSON.stringify(intent),
      errorCode: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    insertOperation(tx, row);
    appendAudit(tx, {
      action: "file.action.prepared",
      decision: "allow",
      clientSessionId,
      resourceType: "file",
      resourceId: id,
      details: { action: input.action, scope: resolved.key },
      now: timestamp,
    });
    return row;
  });
  if (operation.id !== id) return replay(operation, digest);
  let diskChanged = false;
  let completed = false;
  const check = () => {
    options.assertClient?.();
    assertFileScopeMetadata(options.db, resolved);
    try {
      lock.assertHeld();
    } catch {
      fail("RESOURCE_LOCKED", "File write lease expired");
    }
  };
  try {
    const absolute = await destinationPath(resolved, target);
    if (target === source && input.action === "move")
      fail("CONFLICT", "Destination already exists");
    if (await snapshot(absolute)) fail("CONFLICT", "Destination already exists");
    const result: FileActionResult = { path: target, realPath: absolute };
    if (input.action === "move") {
      await authorizeFileTarget(resolved, source);
      const file = await readEditableFile(resolved.root, source);
      options.assertContent?.(file.content);
      if (file.version !== expectedVersion)
        throw new FileManagerError("VERSION_CONFLICT", "File version changed", {
          currentVersion: file.version,
        });
      const before = await snapshot(file.realPath);
      if (
        !before?.isFile() ||
        Number(before.ino) !== file.inode ||
        Number(before.dev) !== file.device
      )
        fail("CONFLICT", "Source changed during move");
      intent.identity = identity(before);
      result.previousPath = source;
      result.previousRealPath = file.realPath;
    }
    updateOperation(options.db, id, {
      status: "WRITING",
      resultJson: JSON.stringify(intent),
      updatedAt: now(),
    });
    await destinationPath(resolved, target);
    if (input.action === "move") await authorizeFileTarget(resolved, source);
    check();
    if (input.action === "createDirectory") {
      await mkdir(absolute);
      diskChanged = true;
    } else if (input.action === "createFile") {
      const handle = await open(absolute, "wx", 0o666);
      diskChanged = true;
      await handle.close();
    } else {
      const previous = path.join(resolved.root, source);
      await link(previous, absolute);
      diskChanged = true;
      await authorizeFileTarget(resolved, source);
      await authorizeFileTarget(resolved, target);
      const after = await readEditableFile(resolved.root, source);
      if (
        after.version !== expectedVersion ||
        identity(await snapshot(previous)) !== intent.identity ||
        identity(await snapshot(absolute)) !== intent.identity
      )
        fail("CONFLICT", "Source changed during move");
      check();
      await unlink(previous);
    }
    complete(options, operation, result);
    completed = true;
    return result;
  } catch (error) {
    const code = errorCode(error);
    const safe =
      error instanceof FileManagerError
        ? error
        : new FileManagerError(
            code === "EEXIST"
              ? "CONFLICT"
              : code === "EXDEV"
                ? "VALIDATION_ERROR"
                : "RESOURCE_UNAVAILABLE",
            code === "EEXIST"
              ? "Destination already exists"
              : "File operation could not be completed",
          );
    immediateTransaction(options.db, (tx) => {
      updateOperation(tx, id, {
        status: diskChanged ? "RECONCILIATION_REQUIRED" : "FAILED",
        errorCode: safe.code,
        updatedAt: now(),
      });
      appendAudit(tx, {
        action: "file.action.failed",
        decision: "deny",
        clientSessionId,
        resourceType: "file",
        resourceId: id,
        details: { code: safe.code, requiresReconciliation: diskChanged },
        now: now(),
      });
    });
    throw safe;
  } finally {
    if (!diskChanged || completed) lock.release();
  }
}

export async function reconcileFileActions(options: FileServiceOptions) {
  for (const operation of pendingOperations(options.db).filter((row) => row.kind === kind)) {
    const release = () =>
      releaseResourceLock(
        { db: options.db },
        {
          id: operation.lockId,
          fencingToken: operation.fencingToken,
        },
      );
    const failed = () =>
      updateOperation(options.db, operation.id, {
        status: "FAILED",
        errorCode: "RESOURCE_UNAVAILABLE",
        updatedAt: Date.now(),
      });
    try {
      if (operation.status === "PREPARED") {
        failed();
        release();
        continue;
      }
      const intent = intentSchema.parse(JSON.parse(operation.resultJson ?? "null"));
      const scope =
        operation.scopeKey === "workspace:default"
          ? { workspace: "default" as const }
          : operation.scopeKey.startsWith("project:")
            ? { projectId: operation.scopeKey.slice(8) }
            : { sessionId: operation.scopeKey.slice(8) };
      const resolved = await resolveFileScope(options.db, options.dataDir, scope);
      if (resolved.root !== operation.rootRealPath) throw new Error("Root changed");
      const target = await destinationPath(resolved, intent.target);
      const targetInfo = await snapshot(target);
      if (intent.action !== "move") {
        if (targetInfo) throw new Error("Creation identity unknown");
        failed();
      } else {
        const previous = await destinationPath(resolved, operation.path);
        const fromInfo = await snapshot(previous);
        if (!intent.identity) throw new Error("Source identity unknown");
        if (!targetInfo && identity(fromInfo) === intent.identity) failed();
        else if (
          !fromInfo &&
          identity(targetInfo) === intent.identity &&
          (await readEditableFile(resolved.root, intent.target)).version ===
            operation.expectedVersion
        ) {
          complete(options, operation, {
            path: intent.target,
            realPath: target,
            previousPath: operation.path,
            previousRealPath: previous,
          });
        } else throw new Error("Move outcome unknown");
      }
      release();
    } catch {
      updateOperation(options.db, operation.id, {
        status: "RECONCILIATION_REQUIRED",
        errorCode: "RESOURCE_UNAVAILABLE",
        updatedAt: Date.now(),
      });
    }
  }
}
