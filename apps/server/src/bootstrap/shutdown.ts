import { type InstanceLock, releaseInstanceLock } from "./lock.js";
import { flushLogger } from "./logger.js";

export interface ClosableApp {
  close(): Promise<unknown> | unknown;
}

export interface ShutdownLogger {
  info(fields: Record<string, unknown>, message?: string): void;
  flush(callback: () => void): void;
}

export interface CreateShutdownOptions {
  app: ClosableApp;
  lock: InstanceLock;
  logger: ShutdownLogger;
  timeoutMs?: number;
  onTimeout?: () => void;
  onClose?: () => Promise<void> | void;
}

export type Shutdown = (reason?: string) => Promise<void>;

export function createShutdown(options: CreateShutdownOptions): Shutdown {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let pending: Promise<void> | null = null;

  const run = async (reason: string): Promise<void> => {
    options.logger.info({ reason }, "server.shutdown");

    const timer = setTimeout(() => {
      if (options.onTimeout) {
        options.onTimeout();
      } else {
        process.exit(1);
      }
    }, timeoutMs);

    let failure: unknown = null;

    try {
      await options.app.close();
    } catch (error) {
      failure = error;
    }

    try {
      await options.onClose?.();
    } catch (error) {
      failure ??= error;
    }

    clearTimeout(timer);
    await releaseInstanceLock(options.lock);
    await flushLogger(options.logger);

    if (failure !== null) {
      throw failure;
    }
  };

  return (reason = "shutdown") => {
    pending ??= run(reason);
    return pending;
  };
}
