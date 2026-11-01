import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { createIpcHandler } from "../ipc/handlers.js";
import { type IpcServer, startIpcServer } from "../ipc/server.js";
import { ensureDataDirs, resolveDataDir } from "../platform/paths.js";
import { SERVER_VERSION } from "../version.js";
import { type LoadedConfig, loadConfig } from "./config.js";
import { acquireInstanceLock, type InstanceLock, releaseInstanceLock } from "./lock.js";
import { createLogger, flushLogger } from "./logger.js";
import { createShutdown, type Shutdown } from "./shutdown.js";

export interface StartServerOptions {
  env?: NodeJS.ProcessEnv;
  logDestination?: DestinationStream;
  shutdownTimeoutMs?: number;
  onShutdownTimeout?: () => void;
  version?: string;
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
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const version = options.version ?? SERVER_VERSION;
  const dataDir = resolveDataDir(env);

  await ensureDataDirs(dataDir);

  const serverRoot = findServerRoot(fileURLToPath(new URL(".", import.meta.url)));
  const webDistCandidate =
    process.env.LARNESS_WEB_DIST ?? path.resolve(serverRoot, "../../apps/web/dist");
  const webDistDir = existsSync(path.join(webDistCandidate, "index.html"))
    ? webDistCandidate
    : undefined;

  const loaded: LoadedConfig = await loadConfig({ dataDir, env });
  const logger = createLogger({
    dataDir,
    level: loaded.config.logging.level,
    retentionDays: loaded.config.logging.retentionDays,
    stderr: process.env.LARNESS_LOG_STDERR !== "0",
    destination: options.logDestination,
  });

  let lock: InstanceLock | null = null;
  let database: OpenedDatabase | null = null;
  let cleanup: CleanupScheduler | null = null;
  let ipc: IpcServer | null = null;
  let app: FastifyInstance | null = null;
  let requestShutdown: ((reason: string) => void) | null = null;

  try {
    lock = await acquireInstanceLock(dataDir, { version });

    const dbPath = path.join(dataDir, "larness.db");
    const opened = openDatabase(dbPath);
    database = opened;
    runMigrations(opened.db);

    const schemaVersion = appliedMigrationCount(opened.sqlite);
    ensureInstanceId(opened.db);

    const cleanupScheduler = startCleanupScheduler(opened.db, { logger });
    cleanup = cleanupScheduler;

    const csrfKey = await loadOrCreateCsrfKey(dataDir);

    const ipcServer = await startIpcServer({
      dataDir,
      version,
      logger,
      handler: createIpcHandler({
        db: opened.db,
        dataDir,
        config: loaded.config,
        webAuthn: loaded.webAuthn,
        csrfKey,
        requestShutdown: (reason) => requestShutdown?.(reason),
      }),
    });
    ipc = ipcServer;

    app = createApp({
      logger,
      services: {
        db: opened.db,
        config: loaded.config,
        webAuthn: loaded.webAuthn,
        csrfKey,
      },
      webDistDir,
    });

    await app.listen({
      host: loaded.config.server.host,
      port: loaded.config.server.port,
    });

    logger.info(
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
      logger,
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
        cleanupScheduler.stop();
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
      logger,
      shutdown,
    };
  } catch (error) {
    logger.error({ err: error }, "server failed to start");

    if (ipc !== null) {
      await ipc.close().catch(() => undefined);
    }

    cleanup?.stop();

    if (database !== null) {
      database.close();
    }
    if (app !== null) {
      await app.close().catch(() => undefined);
    }
    if (lock !== null) {
      await releaseInstanceLock(lock).catch(() => undefined);
    }

    await flushLogger(logger);
    throw error;
  }
}
