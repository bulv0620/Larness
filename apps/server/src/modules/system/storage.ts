import { statSync } from "node:fs";
import path from "node:path";
import { and, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { agentEvents, sessionContextSummaries, turns } from "../../db/schema.js";
import { ACTIVE_TURN_STATUSES } from "../sessions/repository.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

/** D2 defaults; a dry-run report only, nothing is deleted. */
export const DEFAULT_RETENTION_DAYS = { events: 90, turns: 180, summaries: 90 } as const;

export interface TableStorageReport {
  table: string;
  rows: number;
  oldestAt: number | null;
  newestAt: number | null;
  retentionDays: number;
  /** Rows that would leave the retention window, excluding active sessions. */
  candidates: number;
}

export interface StorageReport {
  generatedAt: number;
  database: { file: string; bytes: number; walBytes: number };
  retentionDays: { events: number; turns: number; summaries: number };
  tables: TableStorageReport[];
  candidates: { total: number };
  activeSessions: number;
  /** Retention never deletes data for sessions with an active Turn. */
  policy: "dry_run";
}

function fileBytes(file: string): number {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

function retentionCutoff(now: number, days: number): number {
  return now - Math.max(0, days) * DAY_MS;
}

/**
 * Read-only storage report: per-table volume plus how many rows a retention
 * cleanup would select. Never deletes, never writes.
 */
export function storageReport(
  db: Database,
  options: {
    dataDir: string;
    now?: number;
    retentionDays?: Partial<typeof DEFAULT_RETENTION_DAYS>;
  },
): StorageReport {
  const now = options.now ?? Date.now();
  const retentionDays = { ...DEFAULT_RETENTION_DAYS, ...options.retentionDays };
  const activeSessions = db
    .select({ sessionId: turns.sessionId })
    .from(turns)
    .where(inArray(turns.status, ACTIVE_TURN_STATUSES));

  const events = db
    .select({
      rows: sql<number>`count(*)`,
      oldestAt: sql<number | null>`min(${agentEvents.createdAt})`,
      newestAt: sql<number | null>`max(${agentEvents.createdAt})`,
    })
    .from(agentEvents)
    .get();

  const summaries = db
    .select({
      rows: sql<number>`count(*)`,
      oldestAt: sql<number | null>`min(${sessionContextSummaries.createdAt})`,
      newestAt: sql<number | null>`max(${sessionContextSummaries.createdAt})`,
    })
    .from(sessionContextSummaries)
    .get();

  const turnStats = db
    .select({
      rows: sql<number>`count(*)`,
      oldestAt: sql<number | null>`min(${turns.createdAt})`,
      newestAt: sql<number | null>`max(${turns.createdAt})`,
    })
    .from(turns)
    .get();

  const eventCandidates = db
    .select({ count: sql<number>`count(*)` })
    .from(agentEvents)
    .where(
      and(
        lt(agentEvents.createdAt, retentionCutoff(now, retentionDays.events)),
        notInArray(agentEvents.sessionId, activeSessions),
      ),
    )
    .get();

  const summaryCandidates = db
    .select({ count: sql<number>`count(*)` })
    .from(sessionContextSummaries)
    .where(
      and(
        lt(sessionContextSummaries.createdAt, retentionCutoff(now, retentionDays.summaries)),
        notInArray(sessionContextSummaries.sessionId, activeSessions),
      ),
    )
    .get();

  const turnCandidates = db
    .select({ count: sql<number>`count(*)` })
    .from(turns)
    .where(
      and(
        lt(turns.createdAt, retentionCutoff(now, retentionDays.turns)),
        notInArray(turns.sessionId, activeSessions),
      ),
    )
    .get();

  const databaseFile = path.join(options.dataDir, "larness.db");
  const tables: TableStorageReport[] = [
    {
      table: "agent_events",
      rows: events?.rows ?? 0,
      oldestAt: events?.oldestAt ?? null,
      newestAt: events?.newestAt ?? null,
      retentionDays: retentionDays.events,
      candidates: eventCandidates?.count ?? 0,
    },
    {
      table: "turns",
      rows: turnStats?.rows ?? 0,
      oldestAt: turnStats?.oldestAt ?? null,
      newestAt: turnStats?.newestAt ?? null,
      retentionDays: retentionDays.turns,
      candidates: turnCandidates?.count ?? 0,
    },
    {
      table: "session_context_summaries",
      rows: summaries?.rows ?? 0,
      oldestAt: summaries?.oldestAt ?? null,
      newestAt: summaries?.newestAt ?? null,
      retentionDays: retentionDays.summaries,
      candidates: summaryCandidates?.count ?? 0,
    },
  ];

  return {
    generatedAt: now,
    database: {
      file: databaseFile,
      bytes: fileBytes(databaseFile),
      walBytes: fileBytes(`${databaseFile}-wal`),
    },
    retentionDays,
    tables,
    candidates: { total: tables.reduce((total, table) => total + table.candidates, 0) },
    activeSessions: activeSessions.all().length,
    policy: "dry_run",
  };
}
