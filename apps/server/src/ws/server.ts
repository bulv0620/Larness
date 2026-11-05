import { randomUUID } from "node:crypto";
import websocket from "@fastify/websocket";
import { FileManagerError } from "@larness/resources";
import {
  type AppConfig,
  type CommandOutputEvent,
  CommandSubscriptionSchema,
  FileSubscriptionSchema,
  type ServerEvent,
  ServiceSubscriptionSchema,
  TerminalInputSchema,
  type TerminalOutputEvent,
  TerminalSubscriptionSchema,
  type WebAuthnRuntime,
} from "@larness/shared";
import { eq, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { agentEvents } from "../db/schema.js";
import {
  assertFileScopeMetadata,
  type ResolvedFileScope,
  resolveFileScope,
} from "../modules/files/scope.js";
import type { FileWatchManager } from "../modules/files/watcher.js";
import {
  fileStreamScope,
  type ResourceEventBus,
  resolveResourceStreamScope,
} from "../modules/resources/events.js";
import { resourceSequence } from "../modules/resources/repository.js";
import { getSessionById } from "../modules/sessions/repository.js";
import type { TerminalManager } from "../modules/terminals/manager.js";
import { sessionEvents } from "../security/session-events.js";
import { transportAllowed } from "../security/transport.js";
import { type AgentStreamEvent, agentEventBus } from "./publisher.js";

const PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_SUBSCRIPTIONS = 64;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface WsRouteDeps {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  dataDir: string;
  resourceEvents: ResourceEventBus;
  fileWatches: FileWatchManager;
  terminals: TerminalManager;
  now?: () => number;
}

function readCookie(header: string | undefined, name: string): string {
  if (header === undefined) {
    return "";
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return "";
}

export function send(
  socket: Pick<WebSocket, "readyState" | "OPEN" | "bufferedAmount" | "close" | "send">,
  payload: unknown,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1008, "backpressure");
    return;
  }

  try {
    socket.send(JSON.stringify(payload));
  } catch {
    socket.close(1008, "transport failed");
  }
}

export function registerWsRoutes(app: FastifyInstance, deps: WsRouteDeps): void {
  app.register(websocket, { options: { maxPayload: 1024 * 1024 } });

  app.after(() => {
    app.get(
      "/ws",
      {
        websocket: true,
        preValidation: async (request, reply) => {
          if (request.headers.origin !== deps.webAuthn.origin) {
            return reply.code(403).send({
              error: {
                code: "ORIGIN_INVALID",
                message: "Origin is not allowed",
                requestId: request.id,
              },
            });
          }

          if (!transportAllowed(request, deps.config.auth)) {
            return reply.code(403).send({
              error: {
                code: "HTTPS_REQUIRED",
                message: "HTTPS is required for remote access",
                requestId: request.id,
              },
            });
          }

          const session = resolveActiveSession(
            deps.db,
            readCookie(request.headers.cookie, SESSION_COOKIE),
            {
              now: deps.now?.(),
              idleTtlMinutes: deps.config.auth.idleTtlMinutes,
            },
          );

          if (session === null) {
            return reply.code(401).send({
              error: {
                code: "UNAUTHENTICATED",
                message: "Authentication required",
                requestId: request.id,
              },
            });
          }

          request.clientSession = session;
          return undefined;
        },
      },
      (socket, request) => {
        const session =
          request.clientSession ??
          resolveActiveSession(deps.db, readCookie(request.headers.cookie, SESSION_COOKIE), {
            now: deps.now?.(),
            idleTtlMinutes: deps.config.auth.idleTtlMinutes,
          });

        if (session === null) {
          socket.close(1008, "unauthenticated");
          return;
        }

        const subscriptions = new Set<string>();
        const fileGrants = new Map<string, ResolvedFileScope>();
        const owner = randomUUID();
        let closed = false;
        const sessionToken = readCookie(request.headers.cookie, SESSION_COOKIE);
        let lastPong = Date.now();

        const sessionActive = (): boolean => {
          try {
            return (
              resolveActiveSession(deps.db, sessionToken, {
                now: deps.now?.(),
                idleTtlMinutes: deps.config.auth.idleTtlMinutes,
              }) !== null
            );
          } catch {
            return false;
          }
        };
        const fileDenied = (code: string, message: string, resourceType = "file") => {
          try {
            appendAudit(deps.db, {
              action: `${resourceType}.subscription.denied`,
              decision: "deny",
              clientSessionId: session.id,
              resourceType,
              details: { code, requestId: request.id },
            });
          } catch {
            socket.close(1008, "authorization unavailable");
            return;
          }
          send(socket, { kind: "error", code, message });
        };

        deps.terminals.connect(session.id, owner, sessionActive);
        send(socket, {
          kind: "hello",
          connectionId: owner,
          protocolVersion: PROTOCOL_VERSION,
          clientSessionId: session.id,
          serverTime: Date.now(),
          heartbeatMs: HEARTBEAT_MS,
          topics: [],
        });

        const heartbeat = setInterval(() => {
          if (!sessionActive()) {
            socket.close(1008, "session expired");
            return;
          }

          if (Date.now() - lastPong > HEARTBEAT_TIMEOUT_MS) {
            socket.close(1001, "heartbeat timeout");
            return;
          }

          socket.ping();
        }, HEARTBEAT_MS);
        heartbeat.unref();

        const onPong = (): void => {
          lastPong = Date.now();
        };
        socket.on("pong", onPong);

        const onSessionRevoked = (event: { sessionId: string; reason: string }): void => {
          if (event.sessionId === session.id) {
            try {
              deps.terminals.disconnect(owner);
            } catch {
              /* Revoked authentication already blocks input. */
            }
            socket.close(1008, `session revoked: ${event.reason}`);
          }
        };

        const onDeviceRevoked = (event: { deviceId: string; reason: string }): void => {
          if (session.deviceId !== null && event.deviceId === session.deviceId) {
            try {
              deps.terminals.disconnect(owner);
            } catch {
              /* Revoked authentication already blocks input. */
            }
            socket.close(1008, `device revoked: ${event.reason}`);
          }
        };

        sessionEvents.on("session.revoked", onSessionRevoked);
        sessionEvents.on("device.revoked", onDeviceRevoked);

        const onAgentEvent = (event: AgentStreamEvent): void => {
          if (subscriptions.has(`agent:${event.streamId}`)) {
            send(socket, event);
          }
        };
        agentEventBus.on("event", onAgentEvent);
        const onResourceEvent = (event: ServerEvent): void => {
          if (!subscriptions.has(event.streamId)) return;
          if (!sessionActive()) {
            socket.close(1008, "session expired");
            return;
          }
          if (event.topic === "terminal") {
            try {
              deps.terminals.assertMetadata(event.streamId);
              send(socket, event);
            } catch {
              subscriptions.delete(event.streamId);
              deps.terminals.unsubscribe(event.streamId, owner);
              send(socket, {
                kind: "error",
                code: "FORBIDDEN",
                message: "Terminal subscription unavailable",
              });
            }
            return;
          }
          if (event.topic === "service") {
            const grant = fileGrants.get(event.streamId);
            if (!grant) return;
            try {
              assertFileScopeMetadata(deps.db, grant);
              send(socket, event);
            } catch {
              subscriptions.delete(event.streamId);
              fileGrants.delete(event.streamId);
              send(socket, {
                kind: "error",
                code: "FORBIDDEN",
                message: "Service subscription unavailable",
              });
            }
            return;
          }
          const grant = fileGrants.get(event.streamId);
          try {
            if (!grant) return;
            assertFileScopeMetadata(deps.db, grant);
            send(socket, event);
          } catch {
            subscriptions.delete(event.streamId);
            fileGrants.delete(event.streamId);
            deps.fileWatches.unsubscribe(owner, event.streamId);
            send(socket, {
              kind: "error",
              code: "FORBIDDEN",
              message: "file subscription is no longer authorized",
            });
          }
        };
        deps.resourceEvents.on(onResourceEvent);
        const onOutput = (event: CommandOutputEvent) => {
          if (!subscriptions.has(event.resourceId)) return;
          if (!sessionActive()) {
            socket.close(1008, "session expired");
            return;
          }
          try {
            const grant = fileGrants.get(event.resourceId);
            if (!grant) return;
            assertFileScopeMetadata(deps.db, grant);
            send(socket, event);
          } catch {
            subscriptions.delete(event.resourceId);
            fileGrants.delete(event.resourceId);
            send(socket, {
              kind: "error",
              code: "FORBIDDEN",
              message: "Command subscription is no longer authorized",
            });
          }
        };
        deps.resourceEvents.onOutput(onOutput);
        const onTerminalOutput = (event: TerminalOutputEvent) => {
          if (!subscriptions.has(event.resourceId)) return;
          if (!sessionActive()) {
            socket.close(1008, "session expired");
            return;
          }
          try {
            deps.terminals.assertMetadata(event.resourceId);
            send(socket, event);
          } catch {
            subscriptions.delete(event.resourceId);
            deps.terminals.unsubscribe(event.resourceId, owner);
            send(socket, {
              kind: "error",
              code: "FORBIDDEN",
              message: "Terminal subscription unavailable",
            });
          }
        };
        deps.resourceEvents.onTerminalOutput(onTerminalOutput);

        const processMessage = async (raw: Buffer): Promise<void> => {
          if (closed) return;
          if (!sessionActive()) {
            socket.close(1008, "session expired");
            return;
          }

          let message: unknown;

          try {
            message = JSON.parse(raw.toString("utf8"));
          } catch {
            send(socket, { kind: "error", code: "VALIDATION_ERROR", message: "invalid JSON" });
            return;
          }

          if (typeof message !== "object" || message === null || !("type" in message)) {
            send(socket, { kind: "error", code: "VALIDATION_ERROR", message: "invalid message" });
            return;
          }

          if (message.type === "terminal.input") {
            const parsed = TerminalInputSchema.safeParse(message);
            if (!parsed.success) {
              fileDenied("VALIDATION_ERROR", "Invalid terminal input", "terminal");
              return;
            }
            try {
              const data = parsed.data;
              const result = await deps.terminals.input(
                data.terminalId,
                session.id,
                owner,
                data.leaseGeneration,
                data.inputSequence,
                data.data,
              );
              send(socket, { kind: "terminal.input.ack", resourceId: data.terminalId, ...result });
            } catch (error) {
              fileDenied(
                error instanceof FileManagerError ? error.code : "INTERNAL",
                "Terminal input denied",
                "terminal",
              );
            }
            return;
          }
          if (message.type === "pong") {
            lastPong = Date.now();
            return;
          }

          if (message.type === "subscribe" && "subscriptions" in message) {
            const requested = message.subscriptions;

            if (!Array.isArray(requested)) {
              send(socket, {
                kind: "error",
                code: "VALIDATION_ERROR",
                message: "invalid subscriptions",
              });
              return;
            }
            if (requested.length > MAX_SUBSCRIPTIONS) {
              send(socket, {
                kind: "error",
                code: "RATE_LIMITED",
                message: "too many subscriptions",
              });
              return;
            }

            const accepted: Array<{
              topic: "system" | "agent" | "file" | "command" | "terminal" | "service";
              resourceId: string;
              key: string;
              currentSequence: number;
              paths?: string[];
              grant?: ResolvedFileScope;
            }> = [];

            for (const entry of requested) {
              if (
                typeof entry !== "object" ||
                entry === null ||
                !("topic" in entry) ||
                !("resourceId" in entry)
              ) {
                send(socket, {
                  kind: "error",
                  code: "FORBIDDEN",
                  message: "subscription denied",
                  requestId: request.id,
                });
                return;
              }

              if (entry.topic === "system" && entry.resourceId === "system") {
                accepted.push({
                  topic: "system",
                  resourceId: "system",
                  key: "system",
                  currentSequence: 0,
                });
                continue;
              }
              if (entry.topic === "terminal") {
                const parsed = TerminalSubscriptionSchema.safeParse(entry);
                if (!parsed.success) {
                  fileDenied("VALIDATION_ERROR", "Invalid terminal subscription", "terminal");
                  return;
                }
                try {
                  const row = await deps.terminals.read(parsed.data.resourceId);
                  if (closed || !sessionActive()) {
                    socket.close(1008, "session expired");
                    return;
                  }
                  if (parsed.data.after > row.currentSequence) {
                    fileDenied("VALIDATION_ERROR", "Event cursor is in the future", "terminal");
                    return;
                  }
                  accepted.push({
                    topic: "terminal",
                    resourceId: row.id,
                    key: row.id,
                    currentSequence: row.currentSequence,
                  });
                } catch {
                  fileDenied("FORBIDDEN", "Terminal subscription denied", "terminal");
                  return;
                }
                continue;
              }
              if (entry.topic === "service") {
                const parsed = ServiceSubscriptionSchema.safeParse(entry);
                if (!parsed.success) {
                  fileDenied("VALIDATION_ERROR", "invalid service subscription", "service");
                  return;
                }
                try {
                  const grant = await resolveResourceStreamScope(
                    deps.db,
                    deps.dataDir,
                    parsed.data.resourceId,
                  );
                  if (closed || !sessionActive()) {
                    socket.close(1008, "session expired");
                    return;
                  }
                  if (!grant) throw new Error("Missing service scope");
                  assertFileScopeMetadata(deps.db, grant);
                  const currentSequence = resourceSequence(deps.db, parsed.data.resourceId);
                  if (parsed.data.after > currentSequence) {
                    fileDenied("VALIDATION_ERROR", "event cursor is in the future", "service");
                    return;
                  }
                  accepted.push({
                    topic: "service",
                    resourceId: parsed.data.resourceId,
                    key: parsed.data.resourceId,
                    currentSequence,
                    grant,
                  });
                } catch {
                  fileDenied("FORBIDDEN", "service subscription denied", "service");
                  return;
                }
                continue;
              }
              if (entry.topic === "command") {
                const parsed = CommandSubscriptionSchema.safeParse(entry);
                if (!parsed.success) {
                  fileDenied("VALIDATION_ERROR", "invalid command subscription", "command");
                  return;
                }
                try {
                  const grant = await resolveResourceStreamScope(
                    deps.db,
                    deps.dataDir,
                    parsed.data.resourceId,
                  );
                  if (closed || !sessionActive()) {
                    socket.close(1008, "session expired");
                    return;
                  }
                  if (!grant) throw new Error("Missing command scope");
                  assertFileScopeMetadata(deps.db, grant);
                  const currentSequence = resourceSequence(deps.db, parsed.data.resourceId);
                  if (parsed.data.after > currentSequence) {
                    fileDenied("VALIDATION_ERROR", "event cursor is in the future", "command");
                    return;
                  }
                  accepted.push({
                    topic: "command",
                    resourceId: parsed.data.resourceId,
                    key: parsed.data.resourceId,
                    currentSequence,
                    grant,
                  });
                } catch {
                  fileDenied("FORBIDDEN", "command subscription denied", "command");
                  return;
                }
                continue;
              }
              if (entry.topic === "file") {
                const parsed = FileSubscriptionSchema.safeParse(entry);
                if (!parsed.success) {
                  fileDenied("VALIDATION_ERROR", "invalid file subscription");
                  return;
                }
                const key = `file:${parsed.data.resourceId}`;
                try {
                  const grant = await resolveFileScope(deps.db, deps.dataDir, fileStreamScope(key));
                  if (closed || !sessionActive()) {
                    socket.close(1008, "session expired");
                    return;
                  }
                  const currentSequence = resourceSequence(deps.db, key);
                  if (parsed.data.after > currentSequence) {
                    fileDenied("VALIDATION_ERROR", "event cursor is in the future");
                    return;
                  }
                  accepted.push({
                    topic: "file",
                    resourceId: parsed.data.resourceId,
                    key,
                    currentSequence,
                    paths: parsed.data.paths,
                    grant,
                  });
                } catch {
                  fileDenied("FORBIDDEN", "subscription denied");
                  return;
                }
                continue;
              }

              if (
                entry.topic === "agent" &&
                typeof entry.resourceId === "string" &&
                getSessionById(deps.db, entry.resourceId) !== null
              ) {
                const last = deps.db
                  .select({ sequence: max(agentEvents.seq) })
                  .from(agentEvents)
                  .where(eq(agentEvents.sessionId, entry.resourceId))
                  .get();

                accepted.push({
                  topic: "agent",
                  resourceId: entry.resourceId,
                  key: `agent:${entry.resourceId}`,
                  currentSequence: last?.sequence ?? 0,
                });
                continue;
              }

              send(socket, {
                kind: "error",
                code: "FORBIDDEN",
                message: "subscription denied",
                requestId: request.id,
              });
              return;
            }

            if (
              new Set([...subscriptions, ...accepted.map((entry) => entry.key)]).size >
              MAX_SUBSCRIPTIONS
            ) {
              send(socket, {
                kind: "error",
                code: "RATE_LIMITED",
                message: "too many subscriptions",
              });
              return;
            }

            for (const entry of accepted) {
              subscriptions.add(entry.key);
              if (entry.topic === "terminal") deps.terminals.subscribe(entry.key, owner);
              if (entry.topic === "command" && entry.grant) fileGrants.set(entry.key, entry.grant);
              if (entry.topic === "service" && entry.grant) fileGrants.set(entry.key, entry.grant);
              if (entry.topic === "file" && entry.grant && entry.paths) {
                fileGrants.set(entry.key, entry.grant);
                try {
                  const state = await deps.fileWatches.subscribe(owner, entry.key, entry.paths);
                  if (closed || !sessionActive()) {
                    deps.fileWatches.unsubscribe(owner);
                    socket.close(1008, "session expired");
                    return;
                  }
                  send(socket, {
                    kind: "subscribed",
                    subscription: { topic: "file", resourceId: entry.resourceId },
                    ...state,
                  });
                } catch (error) {
                  subscriptions.delete(entry.key);
                  fileGrants.delete(entry.key);
                  deps.fileWatches.unsubscribe(owner, entry.key);
                  fileDenied(
                    error instanceof FileManagerError ? error.code : "INTERNAL",
                    "file subscription failed",
                  );
                }
                continue;
              }
              send(socket, {
                kind: "subscribed",
                subscription: { topic: entry.topic, resourceId: entry.resourceId },
                currentSequence: entry.currentSequence,
                ...(entry.topic === "terminal" ? { connectionId: owner } : {}),
              });
            }
            return;
          }

          if (message.type === "unsubscribe" && "topics" in message) {
            if (Array.isArray(message.topics)) {
              for (const topic of message.topics) {
                if (typeof topic === "string") {
                  subscriptions.delete(topic);
                  if (topic.startsWith("term_")) deps.terminals.unsubscribe(topic, owner);
                  fileGrants.delete(topic);
                  if (topic.startsWith("file:")) {
                    fileGrants.delete(topic);
                    deps.fileWatches.unsubscribe(owner, topic);
                  }
                }
              }
            }
            return;
          }

          send(socket, {
            kind: "error",
            code: "VALIDATION_ERROR",
            message: "unknown message type",
          });
        };
        let pendingControls = 0;
        let controls = Promise.resolve();
        socket.on("message", (raw: Buffer) => {
          if (++pendingControls > 64) {
            socket.close(1008, "control queue limit");
            return;
          }
          controls = controls
            .then(() => processMessage(raw))
            .catch(() => {
              send(socket, {
                kind: "error",
                code: "INTERNAL",
                message: "message processing failed",
              });
            })
            .finally(() => {
              pendingControls--;
            });
        });

        socket.on("close", () => {
          closed = true;
          clearInterval(heartbeat);
          socket.off("pong", onPong);
          sessionEvents.off("session.revoked", onSessionRevoked);
          sessionEvents.off("device.revoked", onDeviceRevoked);
          agentEventBus.off("event", onAgentEvent);
          deps.resourceEvents.off(onResourceEvent);
          deps.resourceEvents.offOutput(onOutput);
          deps.resourceEvents.offTerminalOutput(onTerminalOutput);
          try {
            deps.terminals.disconnect(owner);
          } catch {
            /* The absent connection already rejects stale input. */
          }
          deps.fileWatches.unsubscribe(owner);
          fileGrants.clear();
          subscriptions.clear();
        });
      },
    );
  });
}
