import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeepSeekProvider, createFileToolRegistry, ProviderError } from "@larness/agent";
import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import type { DestinationStream, Logger } from "pino";
import { createApp } from "../app.js";
import { loadOrCreateCsrfKey } from "../auth/csrf.js";
import { type CleanupScheduler, startCleanupScheduler } from "../db/cleanup.js";
import { type Database, type OpenedDatabase, openDatabase } from "../db/client.js";
import { appliedMigrationCount, findServerRoot, runMigrations } from "../db/migrate.js";
import { appendAudit } from "../db/repositories/audit.js";
import { ensureInstanceId } from "../db/repositories/meta.js";
import { type DevWebTarget, DevWebTargetSchema } from "../dev-web/control.js";
import { managedWebFiles } from "../dev-web/managed.js";
import { recoverInitialization } from "../init/recovery.js";
import { createIpcHandler } from "../ipc/handlers.js";
import { type IpcServer, startIpcServer } from "../ipc/server.js";
import { createCommandTool } from "../modules/agent/commandTool.js";
import { TurnQueue } from "../modules/agent/queue.js";
import { repairInterruptedTurns } from "../modules/agent/repair.js";
import { type ProviderResolver, TurnRunner } from "../modules/agent/turnRunner.js";
import { CommandManager } from "../modules/commands/manager.js";
import { reconcileFileOperations } from "../modules/files/service.js";
import { ensureDefaultModelProfiles, listEncryptedSecrets } from "../modules/models/repository.js";
import { ModelError, resolveModel } from "../modules/models/service.js";
import { ResourceEventBus } from "../modules/resources/events.js";
import { ensureDataDirs, resolveDataDir } from "../platform/paths.js";
import { SecretStore } from "../security/secretStore.js";
import { SERVER_VERSION } from "../version.js";
import { publishAgentEvent } from "../ws/publisher.js";
import { type LoadedConfig, loadConfig } from "./config.js";
import { acquireInstanceLock, type InstanceLock, releaseInstanceLock } from "./lock.js";
import { pruneExpiredLogs, startLogRetention } from "./log-retention.js";
import { createLogger, flushLogger } from "./logger.js";
import { createShutdown, type Shutdown } from "./shutdown.js";

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  devWeb?: DevWebTarget;
  logDestination?: DestinationStream;
  shutdownTimeoutMs?: number;
  onShutdownTimeout?: () => void;
  version?: string;
  turnRunner?: boolean;
  providerResolver?: ProviderResolver;
}

export interface RunningServer {
  app: FastifyInstance;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  dataDir: string;
  db: Database;
  sqlite: OpenedDatabase["sqlite"];
  dbPath: string;
  schemaVersion: number;
  ipc: IpcServer;
  lock: InstanceLock;
  logger: Logger;
  shutdown: Shutdown;
  turnQueue: TurnQueue | null;
  commands: CommandManager;
}

function createDefaultProviderResolver(db: Database, secretStore: SecretStore): ProviderResolver {
  return (session, turn) => {
    let resolved: ReturnType<typeof resolveModel>;

    try {
      resolved = resolveModel({ db, secretStore }, turn.modelProfileId ?? session.modelProfileId);
    } catch (error) {
      if (error instanceof ModelError) {
        throw new ProviderError("PROVIDER_AUTH_FAILED", error.message);
      }

      throw error;
    }

    if (resolved === null) {
      throw new ProviderError("PROVIDER_AUTH_FAILED", "model profile not found");
    }

    const profile = resolved.profile;

    if (profile.provider !== "deepseek") {
      throw new ProviderError("PROVIDER_UNKNOWN", "unsupported model provider");
    }

    return {
      adapter: createDeepSeekProvider(),
      model: profile.model,
      ...(resolved.apiKey === null ? {} : { apiKey: resolved.apiKey }),
      ...(profile.endpoint === null ? {} : { endpoint: profile.endpoint }),
    };
  };
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const version = options.version ?? SERVER_VERSION;
  const dataDir = resolveDataDir(env);

  await ensureDataDirs(dataDir);

  const serverRoot = findServerRoot(fileURLToPath(new URL(".", import.meta.url)));
  const serveWeb = env.LARNESS_SERVE_WEB !== "0";
  const webDistCandidate = env.LARNESS_WEB_DIST ?? path.resolve(serverRoot, "../../apps/web/dist");
  const webDistDir =
    serveWeb && existsSync(path.join(webDistCandidate, "index.html"))
      ? webDistCandidate
      : undefined;

  let lock: InstanceLock | null = null;
  let database: OpenedDatabase | null = null;
  let logger: Logger | null = null;
  let logRetention: ReturnType<typeof startLogRetention> | null = null;
  let cleanup: CleanupScheduler | null = null;
  let ipc: IpcServer | null = null;
  let app: FastifyInstance | null = null;
  let turnQueue: TurnQueue | null = null;
  let commandManager: CommandManager | null = null;
  let requestShutdown: ((reason: string) => void) | null = null;

  try {
    lock = await acquireInstanceLock(dataDir, { version });

    const dbPath = path.join(dataDir, "larness.db");
    const opened = openDatabase(dbPath);
    database = opened;
    runMigrations(opened.db);
    recoverInitialization(opened.db, dataDir);
    const loaded: LoadedConfig = await loadConfig({ dataDir, env });
    let retentionError: unknown;
    try {
      await pruneExpiredLogs(dataDir, loaded.config.logging.retentionDays);
    } catch (error) {
      retentionError = error;
    }
    const activeLogger = createLogger({
      dataDir,
      level: loaded.config.logging.level,
      retentionDays: loaded.config.logging.retentionDays,
      stderr: env.LARNESS_LOG_STDERR !== "0",
      destination: options.logDestination,
    });
    logger = activeLogger;
    if (retentionError !== undefined)
      activeLogger.warn({ err: retentionError }, "log retention failed");
    const retention = startLogRetention(
      dataDir,
      loaded.config.logging.retentionDays,
      activeLogger,
      { initialRun: false },
    );
    logRetention = retention;

    const schemaVersion = appliedMigrationCount(opened.sqlite);
    ensureInstanceId(opened.db);

    const repairedTurns = repairInterruptedTurns({ db: opened.db });

    if (repairedTurns > 0) {
      activeLogger.warn({ repairedTurns }, "marked interrupted turns");
    }

    const secretStore = await SecretStore.open(dataDir, listEncryptedSecrets(opened.db));
    await reconcileFileOperations({ db: opened.db, dataDir });
    const resourceEvents = new ResourceEventBus();
    const commands = new CommandManager({
      db: opened.db,
      dataDir,
      events: resourceEvents,
      secretStore,
      idleTtlMinutes: loaded.config.auth.idleTtlMinutes,
    });
    commandManager = commands;
    await commands.recover();
    ensureDefaultModelProfiles(opened.db);

    const cleanupScheduler = startCleanupScheduler(opened.db, { logger: activeLogger });
    cleanup = cleanupScheduler;

    const csrfKey = await loadOrCreateCsrfKey(dataDir);

    const ipcServer = await startIpcServer({
      dataDir,
      version,
      logger: activeLogger,
      handler: createIpcHandler({
        db: opened.db,
        dataDir,
        config: loaded.config,
        webAuthn: loaded.webAuthn,
        csrfKey,
        env,
        requestShutdown: (reason) => requestShutdown?.(reason),
      }),
    });
    ipc = ipcServer;

    if (options.turnRunner !== false) {
      const registry = createFileToolRegistry();
      registry.register(createCommandTool({ db: opened.db, secretStore }));
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        commands,
        resolveProvider:
          options.providerResolver ?? createDefaultProviderResolver(opened.db, secretStore),
        publish: publishAgentEvent,
      });
      turnQueue = new TurnQueue({
        runner,
        onError: (error, turnId) => {
          activeLogger.error({ err: error, turnId }, "turn runner failed");
        },
      });
    }

    app = createApp({
      logger: activeLogger,
      services: {
        db: opened.db,
        dataDir,
        config: loaded.config,
        webAuthn: loaded.webAuthn,
        csrfKey,
        secretStore,
        commands,
        resourceEvents,
        ...(turnQueue === null
          ? {}
          : {
              turnControls: {
                enqueue: (turnId: string, sessionId: string) =>
                  turnQueue?.enqueue(turnId, sessionId),
                cancel: (turnId: string) => turnQueue?.cancel(turnId) ?? false,
              },
            }),
      },
      webDistDir,
      ...(options.devWeb
        ? {
            devWeb: {
              target: DevWebTargetSchema.parse(options.devWeb),
              ...managedWebFiles(serverRoot, options.devWeb),
            },
          }
        : {}),
    });

    await app.listen({
      host: loaded.config.server.host,
      port: loaded.config.server.port,
    });

    activeLogger.info(
      {
        version,
        dataDir,
        dbPath,
        schemaVersion,
        ipcPath: ipcServer.address.path,
        ipcKind: ipcServer.address.kind,
        host: loaded.config.server.host,
        port: loaded.config.server.port,
        origin: loaded.webAuthn.origin,
        rpId: loaded.webAuthn.rpId,
        passkeyEnabled: loaded.webAuthn.enabled,
        webDist: webDistDir !== undefined,
      },
      "server listening",
    );

    const shutdown = createShutdown({
      app,
      lock,
      logger: activeLogger,
      timeoutMs: options.shutdownTimeoutMs,
      onTimeout: options.onShutdownTimeout,
      onClose: async (reason) => {
        try {
          appendAudit(opened.db, {
            action: "server.shutdown",
            decision: "info",
            details: { reason },
            now: Date.now(),
          });
        } catch {
          // Shutdown must proceed even if the audit write fails.
        }

        await ipcServer.close();
        await turnQueue?.stop();
        cleanupScheduler.stop();
        await retention.stop();
        opened.close();
      },
    });

    requestShutdown = (reason) => {
      void shutdown(reason);
    };

    return {
      app,
      config: loaded.config,
      webAuthn: loaded.webAuthn,
      dataDir,
      db: opened.db,
      sqlite: opened.sqlite,
      dbPath,
      schemaVersion,
      ipc: ipcServer,
      lock,
      logger: activeLogger,
      shutdown,
      turnQueue,
      commands,
    };
  } catch (error) {
    logger?.error({ err: error }, "server failed to start");

    if (ipc !== null) {
      await ipc.close().catch(() => undefined);
    }

    cleanup?.stop();
    await logRetention?.stop();

    await commandManager?.close();
    if (app !== null) {
      await app.close().catch(() => undefined);
    }
    if (database !== null) {
      database.close();
    }
    if (lock !== null) {
      await releaseInstanceLock(lock).catch(() => undefined);
    }

    if (logger !== null) await flushLogger(logger);
    throw error;
  }
}
