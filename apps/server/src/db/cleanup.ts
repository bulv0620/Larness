import { and, inArray, lt } from "drizzle-orm";
import type { Database } from "./client.js";
import { browserSessions, deviceRequests, webauthnChallenges } from "./schema.js";

export interface CleanupResult {
  challenges: number;
  sessions: number;
  requests: number;
}

export function cleanupExpired(db: Database, now = Date.now()): CleanupResult {
  const challenges = db
    .delete(webauthnChallenges)
    .where(lt(webauthnChallenges.expiresAt, now))
    .run().changes;

  const sessions = db
    .delete(browserSessions)
    .where(lt(browserSessions.expiresAt, now))
    .run().changes;

  const requests = db
    .delete(deviceRequests)
    .where(
      and(
        lt(deviceRequests.expiresAt, now),
        inArray(deviceRequests.status, ["pending", "denied", "expired"]),
      ),
    )
    .run().changes;

  return { challenges, sessions, requests };
}

export interface CleanupSchedulerLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface CleanupScheduler {
  stop(): void;
}

export interface StartCleanupOptions {
  intervalMs?: number;
  logger?: CleanupSchedulerLogger;
  now?: () => number;
}

export function startCleanupScheduler(
  db: Database,
  options: StartCleanupOptions = {},
): CleanupScheduler {
  const run = (): void => {
    try {
      const result = cleanupExpired(db, (options.now ?? Date.now)());
      const removed = result.challenges + result.sessions + result.requests;

      if (removed > 0) {
        options.logger?.info({ ...result }, "expired rows cleaned");
      }
    } catch (error) {
      options.logger?.warn({ err: error }, "expired row cleanup failed");
    }
  };

  run();

  const timer = setInterval(run, options.intervalMs ?? 10 * 60_000);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}
