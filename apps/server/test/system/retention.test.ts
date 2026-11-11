import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { agentEvents, sessionContextSummaries, sessions, turns } from "../../src/db/schema.js";
import { runRetentionCleanup } from "../../src/modules/system/retention.js";
import { withTempDir } from "../helpers.js";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000;

function seed(
  db: ReturnType<typeof openDatabase>["db"],
  options: {
    id: string;
    ageDays: number;
    turnStatus?: "COMPLETED" | "RUNNING";
    pinned?: boolean;
  },
): void {
  const at = NOW - options.ageDays * DAY;
  db.insert(sessions)
    .values({
      id: options.id,
      projectId: null,
      workspacePath: `/tmp/${options.id}`,
      title: options.id,
      status: "active",
      approvalPolicyId: "standard",
      createdAt: at,
      updatedAt: at,
      lastActivityAt: at,
      ...(options.pinned === true ? { pinnedAt: at } : {}),
    })
    .run();
  db.insert(turns)
    .values({
      id: `trn_${options.id}`,
      sessionId: options.id,
      status: options.turnStatus ?? "COMPLETED",
      inputJson: JSON.stringify({ text: "x" }),
      createdAt: at,
    })
    .run();
  db.insert(agentEvents)
    .values({
      id: `evt_${options.id}`,
      sessionId: options.id,
      turnId: `trn_${options.id}`,
      seq: 1,
      type: "user.message",
      payloadJson: "{}",
      createdAt: at,
    })
    .run();
  db.insert(sessionContextSummaries)
    .values({
      id: `sum_${options.id}`,
      sessionId: options.id,
      coveredUpToSeq: 1,
      summary: "s",
      tokensBefore: 10,
      tokensAfter: 5,
      createdAt: at,
    })
    .run();
}

const retentionDays = { events: 90, turns: 180, summaries: 90 };

async function fixture(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  seed(opened.db, { id: "ses_expired", ageDays: 400 });
  seed(opened.db, { id: "ses_recent", ageDays: 10 });
  seed(opened.db, { id: "ses_pinned", ageDays: 400, pinned: true });
  seed(opened.db, { id: "ses_running", ageDays: 400, turnStatus: "RUNNING" });
  return opened;
}

function counts(opened: ReturnType<typeof openDatabase>, sessionId: string) {
  const one = (table: string) =>
    (
      opened.sqlite
        .prepare(`SELECT count(*) AS count FROM ${table} WHERE session_id = ?`)
        .get(sessionId) as { count: number }
    ).count;

  return {
    events: one("agent_events"),
    turns: one("turns"),
    summaries: one("session_context_summaries"),
    sessions: (
      opened.sqlite
        .prepare("SELECT count(*) AS count FROM sessions WHERE id = ?")
        .get(sessionId) as {
        count: number;
      }
    ).count,
  };
}

describe("retention cleanup", () => {
  it("only counts candidates by default and deletes nothing", async () => {
    await withTempDir(async (dir) => {
      const opened = await fixture(dir);

      try {
        const result = await runRetentionCleanup({
          db: opened.db,
          now: NOW,
          retentionDays,
          deleteSessions: false,
          keepPinned: true,
        });

        expect(result).toMatchObject({
          dryRun: true,
          sessions: 1,
          events: 1,
          turns: 1,
          summaries: 1,
        });
        expect(counts(opened, "ses_expired").events).toBe(1);
        expect(counts(opened, "ses_expired").sessions).toBe(1);
      } finally {
        opened.close();
      }
    });
  });

  it("deletes expired session data after a backup and skips pinned or active sessions", async () => {
    await withTempDir(async (dir) => {
      const opened = await fixture(dir);
      const backup = vi.fn(async () => path.join(dir, "backups", "retention-test.db"));

      try {
        const result = await runRetentionCleanup({
          db: opened.db,
          now: NOW,
          retentionDays,
          deleteSessions: false,
          keepPinned: true,
          execute: true,
          backup,
        });

        expect(result).toMatchObject({
          dryRun: false,
          sessions: 1,
          events: 1,
          turns: 1,
          summaries: 1,
          backupPath: path.join(dir, "backups", "retention-test.db"),
        });
        expect(backup).toHaveBeenCalledTimes(1);

        expect(counts(opened, "ses_expired")).toEqual({
          events: 0,
          turns: 0,
          summaries: 0,
          sessions: 1,
        });
        expect(counts(opened, "ses_recent").events).toBe(1);
        expect(counts(opened, "ses_pinned").events).toBe(1);
        expect(counts(opened, "ses_running").events).toBe(1);

        const audit = opened.sqlite
          .prepare("SELECT action, details_json FROM audit_logs WHERE action = 'storage.cleanup'")
          .get() as { action: string; details_json: string };
        expect(JSON.parse(audit.details_json)).toMatchObject({
          dryRun: false,
          sessions: 1,
          deleteSessions: false,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("aborts without deleting anything when the backup fails", async () => {
    await withTempDir(async (dir) => {
      const opened = await fixture(dir);

      try {
        await expect(
          runRetentionCleanup({
            db: opened.db,
            now: NOW,
            retentionDays,
            deleteSessions: false,
            keepPinned: true,
            execute: true,
            backup: () => {
              throw new Error("backup unavailable");
            },
          }),
        ).rejects.toThrow("backup unavailable");

        expect(counts(opened, "ses_expired").events).toBe(1);
        expect(counts(opened, "ses_expired").turns).toBe(1);
      } finally {
        opened.close();
      }
    });
  });

  it("removes the session row when deleteSessions is enabled", async () => {
    await withTempDir(async (dir) => {
      const opened = await fixture(dir);

      try {
        await runRetentionCleanup({
          db: opened.db,
          now: NOW,
          retentionDays,
          deleteSessions: true,
          keepPinned: true,
          execute: true,
          backup: () => path.join(dir, "backups", "x.db"),
        });

        expect(counts(opened, "ses_expired")).toEqual({
          events: 0,
          turns: 0,
          summaries: 0,
          sessions: 0,
        });
      } finally {
        opened.close();
      }
    });
  });
});
