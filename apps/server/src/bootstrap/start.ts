import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import type { DestinationStream, Logger } from "pino";
import { createApp } from "../app.js";
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
  lock: InstanceLock;
  logger: Logger;
  shutdown: Shutdown;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const env = options.env ?? process.env;
  const version = options.version ?? SERVER_VERSION;
  const dataDir = resolveDataDir(env);

  await ensureDataDirs(dataDir);

  const loaded: LoadedConfig = await loadConfig({ dataDir, env });
  const logger = createLogger({
    dataDir,
    level: loaded.config.logging.level,
    retentionDays: loaded.config.logging.retentionDays,
    destination: options.logDestination,
  });

  let lock: InstanceLock | null = null;
  let app: FastifyInstance | null = null;

  try {
    lock = await acquireInstanceLock(dataDir, { version });
    app = createApp({ logger });

    await app.listen({
      host: loaded.config.server.host,
      port: loaded.config.server.port,
    });

    logger.info(
      {
        version,
        dataDir,
        host: loaded.config.server.host,
        port: loaded.config.server.port,
        origin: loaded.webAuthn.origin,
        rpId: loaded.webAuthn.rpId,
        passkeyEnabled: loaded.webAuthn.enabled,
      },
      "server listening",
    );

    const shutdown = createShutdown({
      app,
      lock,
      logger,
      timeoutMs: options.shutdownTimeoutMs,
      onTimeout: options.onShutdownTimeout,
    });

    return {
      app,
      config: loaded.config,
      webAuthn: loaded.webAuthn,
      dataDir,
      lock,
      logger,
      shutdown,
    };
  } catch (error) {
    logger.error({ err: error }, "server failed to start");

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
