import { EventEmitter } from "node:events";
import { FileManagerError } from "@larness/resources";
import {
  CommandIdSchema,
  type CommandOutputEvent,
  CommandStatusPayloadSchema,
  FileChangedPayloadSchema,
  FileResyncPayloadSchema,
  type FileScope,
  FileStreamIdSchema,
  RESOURCE_EVENT_RETENTION_MS,
  type ServerEvent,
  TerminalIdSchema,
  type TerminalOutputEvent,
  TerminalPayloadSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { commandRow } from "../commands/repository.js";
import { assertFileScopeMetadata, resolveFileScope } from "../files/scope.js";
import { terminalRow } from "../terminals/repository.js";
import { type ResourceEventRow, readResourceEvents, resourceSequence } from "./repository.js";

export const RESOURCE_RETENTION_MS = RESOURCE_EVENT_RETENTION_MS;
export function fileStreamScope(streamId: string): FileScope {
  const parsed = FileStreamIdSchema.safeParse(streamId);
  if (!parsed.success) throw new FileManagerError("VALIDATION_ERROR", "Invalid file stream");
  const [, kind, id] = streamId.split(":");
  return kind === "project" ? { projectId: id } : { sessionId: id };
}
export function resourceEventDto(row: ResourceEventRow): ServerEvent {
  if (TerminalIdSchema.safeParse(row.streamId).success)
    return {
      kind: "event",
      protocolVersion: 1,
      topic: "terminal",
      eventId: row.id,
      streamId: row.streamId,
      resourceId: row.streamId,
      sequence: row.seq,
      timestamp: row.createdAt,
      type: row.type,
      payload: TerminalPayloadSchema.parse(JSON.parse(row.payloadJson)),
    };
  if (CommandIdSchema.safeParse(row.streamId).success && row.type === "command.status") {
    return {
      kind: "event",
      protocolVersion: 1,
      topic: "command",
      eventId: row.id,
      streamId: row.streamId,
      resourceId: row.streamId,
      sequence: row.seq,
      timestamp: row.createdAt,
      type: row.type,
      payload: CommandStatusPayloadSchema.parse(JSON.parse(row.payloadJson)),
    };
  }
  const scope = fileStreamScope(row.streamId);
  const payload =
    row.type === "file.changed"
      ? FileChangedPayloadSchema.parse(JSON.parse(row.payloadJson))
      : row.type === "file.resync.required"
        ? FileResyncPayloadSchema.parse(JSON.parse(row.payloadJson))
        : null;
  if (payload === null) throw new FileManagerError("INTERNAL", "Invalid resource event");
  return {
    kind: "event",
    protocolVersion: 1,
    topic: "file",
    eventId: row.id,
    streamId: row.streamId,
    sequence: row.seq,
    timestamp: row.createdAt,
    type: row.type,
    payload,
    ...("projectId" in scope ? { projectId: scope.projectId } : { sessionId: scope.sessionId }),
  };
}
// One instance per Server; no cross-database/global publication channel.
export class ResourceEventBus {
  readonly #bus = new EventEmitter();
  on(listener: (event: ServerEvent) => void) {
    this.#bus.on("event", listener);
  }
  off(listener: (event: ServerEvent) => void) {
    this.#bus.off("event", listener);
  }
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void) {
    this.#bus.on("terminal-output", listener);
  }
  offTerminalOutput(listener: (event: TerminalOutputEvent) => void) {
    this.#bus.off("terminal-output", listener);
  }
  publishTerminalOutput(event: TerminalOutputEvent) {
    for (const listener of this.#bus.listeners("terminal-output")) {
      try {
        listener(event);
      } catch {
        /* Cursor replay remains available. */
      }
    }
  }
  onOutput(listener: (event: CommandOutputEvent) => void) {
    this.#bus.on("output", listener);
  }
  offOutput(listener: (event: CommandOutputEvent) => void) {
    this.#bus.off("output", listener);
  }
  publishOutput(event: CommandOutputEvent) {
    for (const listener of this.#bus.listeners("output")) {
      try {
        listener(event);
      } catch {
        /* Output remains available by cursor. */
      }
    }
  }
  publish(row: ResourceEventRow) {
    const event = resourceEventDto(row);
    for (const listener of this.#bus.listeners("event")) {
      try {
        listener(event);
      } catch {
        /* A failed transport cannot roll back committed state. */
      }
    }
  }
}
export async function resolveResourceStreamScope(db: Database, dataDir: string, streamId: string) {
  if (TerminalIdSchema.safeParse(streamId).success) {
    const row = terminalRow(db, streamId);
    if (!row) throw new FileManagerError("NOT_FOUND", "Terminal not found");
    if (!row.projectId && !row.workspaceSessionId) return null;
    return resolveFileScope(
      db,
      dataDir,
      row.projectId
        ? { projectId: row.projectId }
        : { sessionId: row.workspaceSessionId as string },
    );
  }
  if (CommandIdSchema.safeParse(streamId).success) {
    const row = commandRow(db, streamId);
    if (!row) throw new FileManagerError("NOT_FOUND", "Command not found");
    return resolveFileScope(
      db,
      dataDir,
      row.projectId
        ? { projectId: row.projectId }
        : { sessionId: row.workspaceSessionId ?? row.sessionId },
    );
  }
  return resolveFileScope(db, dataDir, fileStreamScope(streamId));
}
export async function listResourceEvents(
  options: { db: Database; dataDir: string; now?: () => number },
  input: { streamId: string; after: number; limit: number },
) {
  const scope = await resolveResourceStreamScope(options.db, options.dataDir, input.streamId);
  if (scope) assertFileScopeMetadata(options.db, scope);
  const currentSequence = resourceSequence(options.db, input.streamId);
  if (input.after > currentSequence)
    throw new FileManagerError("VALIDATION_ERROR", "Event cursor is in the future");
  const rows = readResourceEvents(
    options.db,
    input.streamId,
    input.after,
    input.limit,
    (options.now?.() ?? Date.now()) - RESOURCE_RETENTION_MS,
  );
  let next = input.after + 1;
  let resyncRequired = false;
  for (const row of rows) {
    if (row.seq !== next) resyncRequired = true;
    next = row.seq + 1;
  }
  if (rows.length === 0 && input.after < currentSequence) resyncRequired = true;
  if (rows.length < input.limit && next - 1 < currentSequence) resyncRequired = true;
  return { items: rows.map(resourceEventDto), currentSequence, resyncRequired };
}
