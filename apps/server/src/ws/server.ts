import websocket from "@fastify/websocket";
import type { AppConfig, ServerEvent, WebAuthnRuntime } from "@larness/shared";
import { eq, max } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { agentEvents } from "../db/schema.js";
import { getSessionById } from "../modules/sessions/repository.js";
import { sessionEvents } from "../security/session-events.js";
import { transportAllowed } from "../security/transport.js";
import { agentEventBus } from "./publisher.js";

const PROTOCOL_VERSION = 1;
const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_SUBSCRIPTIONS = 64;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface WsRouteDeps {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
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

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1008, "backpressure");
    return;
  }

  socket.send(JSON.stringify(payload));
}

export function registerWsRoutes(app: FastifyInstance, deps: WsRouteDeps): void {
  app.register(websocket);

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
        const sessionToken = readCookie(request.headers.cookie, SESSION_COOKIE);
        let lastPong = Date.now();

        const sessionActive = (): boolean =>
          resolveActiveSession(deps.db, sessionToken, {
            now: deps.now?.(),
            idleTtlMinutes: deps.config.auth.idleTtlMinutes,
          }) !== null;

        send(socket, {
          kind: "hello",
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
            socket.close(1008, `session revoked: ${event.reason}`);
          }
        };

        const onDeviceRevoked = (event: { deviceId: string; reason: string }): void => {
          if (session.deviceId !== null && event.deviceId === session.deviceId) {
            socket.close(1008, `device revoked: ${event.reason}`);
          }
        };

        sessionEvents.on("session.revoked", onSessionRevoked);
        sessionEvents.on("device.revoked", onDeviceRevoked);

        const onAgentEvent = (event: ServerEvent): void => {
          if (subscriptions.has(`agent:${event.streamId}`)) {
            send(socket, event);
          }
        };
        agentEventBus.on("event", onAgentEvent);

        socket.on("message", (raw: Buffer) => {
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

            const accepted: Array<{
              topic: "system" | "agent";
              resourceId: string;
              key: string;
              currentSequence: number;
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
              send(socket, {
                kind: "subscribed",
                subscription: { topic: entry.topic, resourceId: entry.resourceId },
                currentSequence: entry.currentSequence,
              });
            }
            return;
          }

          if (message.type === "unsubscribe" && "topics" in message) {
            if (Array.isArray(message.topics)) {
              for (const topic of message.topics) {
                if (typeof topic === "string") {
                  subscriptions.delete(topic);
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
        });

        socket.on("close", () => {
          clearInterval(heartbeat);
          socket.off("pong", onPong);
          sessionEvents.off("session.revoked", onSessionRevoked);
          sessionEvents.off("device.revoked", onDeviceRevoked);
          agentEventBus.off("event", onAgentEvent);
          subscriptions.clear();
        });
      },
    );
  });
}
