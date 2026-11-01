import cookie from "@fastify/cookie";
import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerAuthRoutes } from "./api/auth.js";
import { registerBootstrapRoutes } from "./api/bootstrap.js";
import { registerHealthRoute } from "./api/health.js";
import { registerPairingRoutes } from "./api/pairing.js";
import { registerStaticRoutes } from "./api/static.js";
import { registerWebAuthnRoutes } from "./api/webauthn.js";
import type { Database } from "./db/client.js";
import { registerErrorHandler } from "./errors.js";
import { resolveRequestId } from "./request-id.js";
import { installSecurityGuard } from "./security/guard.js";
import { RateLimiter } from "./security/rate-limit.js";
import { registerWsRoutes } from "./ws/server.js";

export interface AppServices {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
}

export interface CreateAppOptions {
  startedAt?: number;
  logger?: FastifyBaseLogger;
  services?: AppServices;
  webDistDir?: string;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();

  const app = Fastify({
    ...(options.logger ? { loggerInstance: options.logger } : { logger: false }),
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers["x-request-id"]),
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);

    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
    }

    return payload;
  });

  app.register(cookie);

  registerErrorHandler(app);
  registerHealthRoute(app, startedAt);

  if (options.services) {
    installSecurityGuard(app, {
      ...options.services,
      limiter: new RateLimiter(),
    });
    registerBootstrapRoutes(app, options.services);
  }

  if (options.services) {
    registerAuthRoutes(app, options.services);
    registerPairingRoutes(app, options.services);
    registerWebAuthnRoutes(app, options.services);
    registerWsRoutes(app, options.services);
  }

  if (options.webDistDir !== undefined) {
    registerStaticRoutes(app, { webDistDir: options.webDistDir });
  }

  return app;
}
