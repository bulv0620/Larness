import "@fastify/cookie";
import type { AppConfig } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { csrfTokenFor } from "../auth/csrf.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { revokeSession } from "../db/repositories/browser-sessions.js";
import { getActiveCredentialByDevice } from "../db/repositories/webauthn-credentials.js";
import { immediateTransaction } from "../db/transaction.js";
import { HttpError } from "../errors.js";
import { emitSessionRevoked } from "../security/session-events.js";

export interface AuthApiDeps {
  db: Database;
  config: AppConfig;
  csrfKey: Buffer;
  now?: () => number;
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthApiDeps): void {
  app.get("/api/auth/session", async (request) => {
    const token = request.cookies[SESSION_COOKIE] ?? "";
    const session = resolveActiveSession(deps.db, token, {
      now: deps.now?.(),
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });

    if (session === null) {
      throw new HttpError("UNAUTHENTICATED", "Authentication required");
    }

    const credential =
      session.deviceId === null ? null : getActiveCredentialByDevice(deps.db, session.deviceId);

    return {
      clientSessionId: session.id,
      deviceId: session.deviceId,
      kind: session.kind,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      csrfToken: csrfTokenFor(session.id, deps.csrfKey),
      capabilities: ["workspace.read", "workspace.write"],
      ...(credential === null
        ? {}
        : {
            passkey: {
              backupEligible: credential.backupEligible,
              backupState: credential.backupState,
            },
          }),
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const session = request.clientSession;

    if (session === null) {
      throw new HttpError("UNAUTHENTICATED", "Authentication required");
    }

    immediateTransaction(deps.db, (tx) => {
      revokeSession(tx, session.id, deps.now?.());

      appendAudit(tx, {
        action: "auth.logout",
        decision: "allow",
        resourceType: "session",
        resourceId: session.id,
        now: deps.now?.(),
      });
    });

    emitSessionRevoked(session.id, "logout");
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(204).send();
  });
}
