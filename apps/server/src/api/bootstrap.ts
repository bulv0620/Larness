import "@fastify/cookie";
import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { isInitialized } from "../auth/initialized.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { listActiveCredentials } from "../db/repositories/webauthn-credentials.js";
import { SERVER_VERSION } from "../version.js";

export interface BootstrapApiDeps {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  now?: () => number;
}

export function registerBootstrapRoutes(app: FastifyInstance, deps: BootstrapApiDeps): void {
  app.get("/api/bootstrap", async (request) => {
    const initialized = isInitialized(deps.db);
    const session = initialized
      ? resolveActiveSession(deps.db, request.cookies[SESSION_COOKIE] ?? "", {
          now: deps.now?.(),
          idleTtlMinutes: deps.config.auth.idleTtlMinutes,
        })
      : null;
    const passkeyRegistered = initialized && listActiveCredentials(deps.db).length > 0;

    return {
      app: { name: "Larness", version: SERVER_VERSION },
      initialized,
      auth: {
        authenticated: session !== null,
        pairingEnabled: initialized,
        passkeyEnabled: initialized ? deps.webAuthn.enabled : false,
        passkeyOrigin: deps.webAuthn.origin,
        passkeyRegistered,
      },
      features: { preview: false },
      serverTime: deps.now?.() ?? Date.now(),
    };
  });
}
