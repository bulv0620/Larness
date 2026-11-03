import cookie from "@fastify/cookie";
import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { registerApprovalRoutes } from "./api/approvals.js";
import { registerAuthRoutes } from "./api/auth.js";
import { registerBootstrapRoutes } from "./api/bootstrap.js";
import { registerCommandRoutes } from "./api/commands.js";
import { registerFileRoutes } from "./api/files.js";
import { registerFsRoutes } from "./api/fs.js";
import { registerHealthRoute } from "./api/health.js";
import { registerModelRoutes } from "./api/models.js";
import { registerPairingRoutes } from "./api/pairing.js";
import { registerProjectRoutes } from "./api/projects.js";
import { registerResourceEventRoutes } from "./api/resource-events.js";
import { registerSessionRoutes, type TurnControls } from "./api/sessions.js";
import { registerStaticRoutes } from "./api/static.js";
import { registerWebAuthnRoutes } from "./api/webauthn.js";
import { resolveActiveSession } from "./auth/sessions.js";
import type { Database } from "./db/client.js";
import { appendAudit } from "./db/repositories/audit.js";
import { type DevWebOptions, registerDevWeb } from "./dev-web/routes.js";
import { registerErrorHandler } from "./errors.js";
import { CommandManager } from "./modules/commands/manager.js";
import { knownCredentialGuard } from "./modules/files/credentials.js";
import { FileWatchManager } from "./modules/files/watcher.js";
import { ResourceEventBus } from "./modules/resources/events.js";
import { resolveRequestId } from "./request-id.js";
import { installSecurityGuard } from "./security/guard.js";
import { RateLimiter } from "./security/rate-limit.js";
import type { SecretStore } from "./security/secretStore.js";
import { registerWsRoutes } from "./ws/server.js";

export interface AppServices {
  db: Database;
  dataDir: string;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
  secretStore?: SecretStore;
  turnControls?: TurnControls;
  commands?: CommandManager;
  resourceEvents?: ResourceEventBus;
}

export interface CreateAppOptions {
  startedAt?: number;
  logger?: FastifyBaseLogger;
  services?: AppServices;
  webDistDir?: string;
  devWeb?: Pick<DevWebOptions, "target" | "webRoot" | "roots">;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();
  const trustedProxies = options.services?.config.server.trustedProxies ?? [];

  const app = Fastify({
    ...(options.logger ? { loggerInstance: options.logger } : { logger: false }),
    requestIdHeader: false,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
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
    const resourceEvents = options.services.resourceEvents ?? new ResourceEventBus();
    const commands =
      options.services.commands ??
      new CommandManager({
        db: options.services.db,
        dataDir: options.services.dataDir,
        events: resourceEvents,
        secretStore: options.services.secretStore,
        idleTtlMinutes: options.services.config.auth.idleTtlMinutes,
      });
    const fileWatches = new FileWatchManager({
      db: options.services.db,
      dataDir: options.services.dataDir,
      events: resourceEvents,
      checkMetadata: knownCredentialGuard(options.services.db, options.services.secretStore),
    });
    app.addHook("onClose", async () => {
      await commands.close();
      await fileWatches.close();
    });
    registerAuthRoutes(app, options.services);
    if (options.services.secretStore !== undefined) {
      registerModelRoutes(app, {
        db: options.services.db,
        secretStore: options.services.secretStore,
      });
    }
    registerApprovalRoutes(app, { db: options.services.db });
    registerFsRoutes(app);
    registerCommandRoutes(app, options.services, commands);
    registerFileRoutes(app, options.services, resourceEvents);
    registerResourceEventRoutes(app, options.services);
    registerProjectRoutes(app, { db: options.services.db });
    registerSessionRoutes(app, {
      db: options.services.db,
      dataDir: options.services.dataDir,
      ...(options.services.turnControls === undefined
        ? {}
        : { turnControls: options.services.turnControls }),
    });
    registerPairingRoutes(app, options.services);
    registerWebAuthnRoutes(app, options.services);
    registerWsRoutes(app, { ...options.services, resourceEvents, fileWatches });
  }

  if (options.devWeb) {
    const services = options.services;
    if (!services) throw new Error("开发页面需要后端授权服务");
    registerDevWeb(app, {
      ...options.devWeb,
      config: services.config,
      origin: services.webAuthn.origin,
      resolveSession: (request) =>
        resolveActiveSession(services.db, request.cookies.larness_session ?? "", {
          idleTtlMinutes: services.config.auth.idleTtlMinutes,
        }),
      auditReject: (code) =>
        appendAudit(services.db, {
          action: "dev-web.rejected",
          decision: "deny",
          details: { code },
          now: Date.now(),
        }),
    });
  }
  if (!options.devWeb && options.webDistDir !== undefined) {
    registerStaticRoutes(app, { webDistDir: options.webDistDir });
  }

  return app;
}
