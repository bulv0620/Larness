import "@fastify/cookie";
import type { AppConfig } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { csrfTokenFor } from "../auth/csrf.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";

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

    return {
      clientSessionId: session.id,
      deviceId: session.deviceId,
      kind: session.kind,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      csrfToken: csrfTokenFor(session.id, deps.csrfKey),
      capabilities: ["workspace.read", "workspace.write"],
    };
  });
}
