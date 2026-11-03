import { randomUUID } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  encodeEditableContent,
  FileManagerError,
  hashContent,
  isInsideRoot,
  listDirectory,
  normalizeFilePath,
  readEditableFile,
  saveEditableFile,
} from "@larness/resources";
import {
  ERROR_CODES,
  type FileSaveResult,
  FileSaveResultSchema,
  type FileScope,
} from "@larness/shared";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ResourceOperationRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { ProjectWriteLock } from "../agent/projectWriteLock.js";
import { releaseResourceLock } from "../locks/service.js";
import {
  appendResourceEvent,
  cacheFileVersion,
  findOperation,
  insertOperation,
  pendingOperations,
  updateOperation,
} from "../resources/repository.js";
import { assertFileScopeMetadata, authorizeFileTarget, resolveFileScope } from "./scope.js";

export interface FileServiceOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
  assertClient?: () => void;
  assertContent?: (content: string) => void;
}
function rejectUnknown(error: unknown): FileManagerError {
  return error instanceof FileManagerError
    ? error
    : new FileManagerError("INTERNAL", "File operation failed");
}
export async function getFile(
  options: FileServiceOptions,
  scope: FileScope,
  input: { path: string; version?: string },
) {
  const resolved = await resolveFileScope(options.db, options.dataDir, scope);
  const relative = await authorizeFileTarget(resolved, input.path);
  const file = await readEditableFile(resolved.root, relative);
  options.assertClient?.();
  assertFileScopeMetadata(options.db, resolved);
  options.assertContent?.(file.content);
  if (input.version !== undefined && input.version !== file.version)
    throw new FileManagerError("VERSION_CONFLICT", "File version changed", {
      currentVersion: file.version,
    });
  return {
    path: file.path,
    realPath: file.realPath,
    content: file.content,
    version: file.version,
    size: file.size,
    encoding: file.encoding,
  };
}
export async function getDirectory(
  options: FileServiceOptions,
  scope: FileScope,
  input: { path: string; limit: number; cursor?: string },
) {
  const resolved = await resolveFileScope(options.db, options.dataDir, scope);
  await authorizeFileTarget(resolved, input.path);
  const result = await listDirectory(resolved.root, {
    ...input,
    ignore: resolved.ignore,
    exclude:
      "projectId" in scope ? (target) => isInsideRoot(resolved.protectedRoot, target) : undefined,
  });
  options.assertClient?.();
  assertFileScopeMetadata(options.db, resolved);
  return result;
}
function replay(operation: ResourceOperationRow, paramsHash: string): FileSaveResult {
  if (operation.paramsHash !== paramsHash)
    throw new FileManagerError("CONFLICT", "Idempotency key belongs to another request");
  if (operation.status === "COMPLETED")
    return FileSaveResultSchema.parse(JSON.parse(operation.resultJson ?? "null"));
  if (operation.status === "FAILED") {
    const details = z
      .object({ currentVersion: z.string() })
      .optional()
      .parse(operation.resultJson ? JSON.parse(operation.resultJson) : undefined);
    const code = z.enum(ERROR_CODES).safeParse(operation.errorCode);
    throw new FileManagerError(
      code.success ? code.data : "INTERNAL",
      "Previous file operation failed",
      details,
    );
  }
  throw new FileManagerError(
    "RESOURCE_UNAVAILABLE",
    "File operation awaits completion or reconciliation",
  );
}
function complete(
  options: FileServiceOptions,
  operation: ResourceOperationRow,
  result: FileSaveResult,
  mtime: number,
) {
  const now = options.now?.() ?? Date.now();
  return immediateTransaction(options.db, (tx) => {
    cacheFileVersion(tx, {
      scopeKey: operation.scopeKey,
      path: result.path,
      realPath: result.realPath,
      versionHash: result.version,
      size: result.size,
      mtime: Math.trunc(mtime),
      updatedAt: now,
    });
    const event = appendResourceEvent(
      tx,
      `file:${operation.scopeKey}`,
      "file.changed",
      {
        path: result.path,
        version: result.version,
        changeType: "modified",
      },
      now,
    );
    updateOperation(tx, operation.id, {
      status: "COMPLETED",
      resultJson: JSON.stringify(result),
      updatedAt: now,
      errorCode: null,
    });
    appendAudit(tx, {
      action: "file.saved",
      decision: "allow",
      clientSessionId: operation.clientSessionId,
      resourceType: "file",
      resourceId: operation.id,
      details: { scope: operation.scopeKey, path: result.path, sequence: event.seq },
      now,
    });
    return result;
  });
}

export async function saveFile(
  options: FileServiceOptions,
  input: {
    scope: FileScope;
    path: string;
    content: string;
    expectedVersion: string;
  },
  clientSessionId: string,
  idempotencyKey: string = randomUUID(),
) {
  const resolved = await resolveFileScope(options.db, options.dataDir, input.scope);
  const relative = normalizeFilePath(input.path);
  const bytes = encodeEditableContent(input.content);
  options.assertContent?.(input.content);
  const targetVersion = hashContent(bytes);
  const paramsHash = hashContent(
    Buffer.from(JSON.stringify([resolved.key, relative, input.expectedVersion, targetVersion])),
  );
  const existing = findOperation(options.db, clientSessionId, idempotencyKey);
  if (existing) {
    options.assertClient?.();
    return replay(existing, paramsHash);
  }
  await authorizeFileTarget(resolved, relative);
  const id = newId("op");
  const lock = new ProjectWriteLock({
    db: options.db,
    projectId:
      "projectId" in input.scope ? input.scope.projectId : `workspace:${input.scope.sessionId}`,
    rootRealPath: resolved.root,
    owner: clientSessionId,
    executionId: id,
    now: options.now,
  });
  let operation: ResourceOperationRow;
  try {
    operation = immediateTransaction(options.db, (tx) => {
      options.assertClient?.();
      assertFileScopeMetadata(options.db, resolved);
      // Another request may have completed while scope/path resolution awaited IO.
      const duplicate = findOperation(tx, clientSessionId, idempotencyKey);
      if (duplicate) return duplicate;
      const handle = lock.acquire();
      if (!handle)
        throw new FileManagerError("RESOURCE_LOCKED", "Authorized root has an active writer");
      const now = options.now?.() ?? Date.now();
      const row: ResourceOperationRow = {
        id,
        scopeKey: resolved.key,
        rootRealPath: resolved.root,
        kind: "file.save",
        status: "PREPARED",
        paramsHash,
        idempotencyKey,
        clientSessionId,
        path: relative,
        expectedVersion: input.expectedVersion,
        targetVersion,
        lockId: handle.id,
        fencingToken: handle.fencingToken,
        resultJson: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      insertOperation(tx, row);
      appendAudit(tx, {
        action: "file.write.prepared",
        decision: "allow",
        clientSessionId,
        resourceType: "file",
        resourceId: id,
        details: { scope: resolved.key, path: relative },
        now,
      });
      return row;
    });
  } catch (error) {
    throw rejectUnknown(error);
  }
  if (operation.id !== id) return replay(operation, paramsHash);
  let replaced = false;
  let completed = false;
  let requiresReconciliation = false;
  const assertFence = () => {
    options.assertClient?.();
    assertFileScopeMetadata(options.db, resolved);
    try {
      lock.assertHeld();
    } catch {
      throw new FileManagerError("RESOURCE_LOCKED", "File write lease expired");
    }
  };
  const heartbeat = setInterval(() => {
    try {
      lock.renew();
    } catch {
      /* assertFence fails closed before rename */
    }
  }, 10_000);
  heartbeat.unref();
  try {
    updateOperation(options.db, id, {
      status: "WRITING",
      updatedAt: options.now?.() ?? Date.now(),
    });
    const file = await saveEditableFile(
      resolved.root,
      { ...input, path: relative },
      {
        beforeCommit: async () => {
          const current = await resolveFileScope(options.db, options.dataDir, input.scope);
          if (current.root !== resolved.root)
            throw new FileManagerError("PATH_OUTSIDE_PROJECT", "Authorized root changed");
          await authorizeFileTarget(current, relative);
          assertFence();
        },
        assertFence,
        temporaryName: `.larness-save-${id}`,
        onReplaced: () => {
          replaced = true;
        },
      },
    );
    const result = {
      path: file.path,
      realPath: file.realPath,
      version: file.version,
      previousVersion: input.expectedVersion,
      size: file.size,
    };
    complete(options, operation, result, (await stat(file.realPath)).mtimeMs);
    completed = true;
    return result;
  } catch (error) {
    const safe = rejectUnknown(error);
    requiresReconciliation = replaced || safe.requiresReconciliation;
    try {
      immediateTransaction(options.db, (tx) => {
        updateOperation(tx, id, {
          status: requiresReconciliation ? "RECONCILIATION_REQUIRED" : "FAILED",
          errorCode: safe.code,
          resultJson: safe.details ? JSON.stringify(safe.details) : null,
          updatedAt: options.now?.() ?? Date.now(),
        });
        appendAudit(tx, {
          action: "file.write.failed",
          decision: "deny",
          clientSessionId,
          resourceType: "file",
          resourceId: id,
          details: { code: safe.code, requiresReconciliation },
          now: options.now?.() ?? Date.now(),
        });
      });
    } catch {
      /* The durable WRITING intent remains blocked if persistence fails. */
    }
    throw safe;
  } finally {
    clearInterval(heartbeat);
    if ((!replaced && !requiresReconciliation) || completed) lock.release();
  }
}

// Startup only, after migrations and before accepting new work. Never rewrite source.
export async function reconcileFileOperations(options: FileServiceOptions) {
  for (const operation of pendingOperations(options.db).filter((row) => row.kind === "file.save")) {
    try {
      const scope = operation.scopeKey.startsWith("project:")
        ? { projectId: operation.scopeKey.slice(8) }
        : { sessionId: operation.scopeKey.slice(8) };
      const resolved = await resolveFileScope(options.db, options.dataDir, scope);
      if (resolved.root !== operation.rootRealPath) throw new Error("root changed");
      await authorizeFileTarget(resolved, operation.path);
      const file = await readEditableFile(resolved.root, operation.path);
      if (file.version !== operation.expectedVersion && file.version !== operation.targetVersion) {
        throw new Error("external version conflict");
      }
      // Clean only this persisted operation's exact temporary name, and only
      // when its bytes still match the intended save. Never scan/delete drafts.
      const temporary = path.posix.join(
        path.posix.dirname(operation.path),
        `.larness-save-${operation.id}`,
      );
      try {
        await authorizeFileTarget(resolved, temporary);
        const draft = await readEditableFile(resolved.root, temporary);
        if (draft.version !== operation.targetVersion)
          throw new Error("temporary identity uncertain");
        await rm(draft.realPath);
      } catch (error) {
        if (!(error instanceof FileManagerError) || error.code !== "NOT_FOUND") throw error;
      }
      if (operation.status !== "PREPARED" && file.version === operation.targetVersion) {
        complete(
          options,
          operation,
          {
            path: file.path,
            realPath: file.realPath,
            version: file.version,
            previousVersion: operation.expectedVersion,
            size: file.size,
          },
          file.mtime,
        );
      } else if (file.version === operation.expectedVersion) {
        updateOperation(options.db, operation.id, {
          status: "FAILED",
          errorCode: "RESOURCE_UNAVAILABLE",
          updatedAt: options.now?.() ?? Date.now(),
        });
      } else throw new Error("external version conflict");
      releaseResourceLock(
        { db: options.db, now: options.now },
        { id: operation.lockId, fencingToken: operation.fencingToken },
      );
    } catch {
      updateOperation(options.db, operation.id, {
        status: "RECONCILIATION_REQUIRED",
        errorCode: "RESOURCE_UNAVAILABLE",
        updatedAt: options.now?.() ?? Date.now(),
      });
    }
  }
}
