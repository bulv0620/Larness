import path from "node:path";
import type { LogLevel } from "@larness/shared";
import pino, { type DestinationStream, type Logger } from "pino";
import { REDACT_OPTIONS } from "../security/redact.js";

export interface CreateLoggerOptions {
  dataDir: string;
  level: LogLevel;
  retentionDays: number;
  destination?: DestinationStream;
  stderr?: boolean;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const base = {
    name: "larness",
    level: options.level,
    redact: REDACT_OPTIONS,
  };

  if (options.destination) {
    return pino(base, options.destination);
  }

  const logFile = path.join(options.dataDir, "logs", "larness.log");
  const rollTarget: import("pino").TransportTargetOptions = {
    target: "pino-roll",
    options: {
      file: logFile,
      frequency: "daily" as const,
      size: "100m",
      mkdir: true,
      mode: 0o600,
      limit: { count: options.retentionDays },
    },
  };

  const transport =
    options.stderr === false
      ? pino.transport({ targets: [rollTarget] })
      : pino.transport({
          targets: [{ target: "pino/file", options: { destination: 2 } }, rollTarget],
        });

  return pino(base, transport);
}

export function flushLogger(logger: Pick<Logger, "flush">, timeoutMs = 500): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);

    try {
      logger.flush(() => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}
