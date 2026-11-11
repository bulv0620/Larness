import { type CleanupConfig, RESOURCE_EVENT_RETENTION_MS } from "@larness/shared";
import { and, inArray, lt } from "drizzle-orm";
import { expirePendingApprovals } from "../modules/agent/approvalService.js";
import { pruneResourceEvents } from "../modules/resources/repository.js";
import { runRetentionCleanup } from "../modules/system/retention.js";
import type { Database } from "./client.js";
import { browserSessions, deviceRequests, webauthnChallenges } from "./schema.js";

export interface CleanupResult {
  challenges: number;
  sessions: number;
  requests: number;
  approvals: number;
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

  const approvals = expirePendingApprovals({ db, now: () => now });
  pruneResourceEvents(db, now - RESOURCE_EVENT_RETENTION_MS);

  return { challenges, sessions, requests, approvals };
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
  /** Retention deletion stays off unless `config.enabled` is true (ADR-058). */
  retention?: {
    config: CleanupConfig;
    backup: () => Promise<string> | string;
  };
}

export function startCleanupScheduler(
  db: Database,
  options: StartCleanupOptions = {},
): CleanupScheduler {
  const runRetention = async (): Promise<void> => {
    const retention = options.retention;

    if (retention === undefined || !retention.config.enabled) {
      return;
    }

    try {
      const result = await runRetentionCleanup({
        db,
        ...(options.now === undefined ? {} : { now: options.now() }),
        retentionDays: retention.config.retentionDays,
        deleteSessions: retention.config.deleteSessions,
        keepPinned: retention.config.keepPinned,
        execute: true,
        backup: retention.backup,
      });

      options.logger?.info({ ...result }, "retention cleanup finished");
    } catch (error) {
      options.logger?.warn({ err: error }, "retention cleanup failed");
    }
  };

  const run = (): void => {
    try {
      const result = cleanupExpired(db, (options.now ?? Date.now)());
      const removed = result.challenges + result.sessions + result.requests + result.approvals;

      if (removed > 0) {
        options.logger?.info({ ...result }, "expired rows cleaned");
      }
    } catch (error) {
      options.logger?.warn({ err: error }, "expired row cleanup failed");
    }

    void runRetention();
  };

  run();

  const timer = setInterval(run, options.intervalMs ?? 10 * 60_000);
  timer.unref();

  return {
    stop: () => clearInterval(timer),
  };
}
