import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { agentEvents, sessionContextSummaries, sessions, turns } from "../../src/db/schema.js";
import { storageReport } from "../../src/modules/system/storage.js";
import { withTempDir } from "../helpers.js";

const DAY = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000; // fixed clock

function seed(
  db: ReturnType<typeof openDatabase>["db"],
  options: { id: string; createdAt: number; turnStatus: "COMPLETED" | "RUNNING" },
): void {
  db.insert(sessions)
    .values({
      id: options.id,
      projectId: null,
      workspacePath: `/tmp/${options.id}`,
      title: options.id,
      status: "active",
      approvalPolicyId: "standard",
      createdAt: options.createdAt,
      updatedAt: options.createdAt,
      lastActivityAt: options.createdAt,
    })
    .run();
  db.insert(turns)
    .values({
      id: `trn_${options.id}`,
      sessionId: options.id,
      status: options.turnStatus,
      inputJson: JSON.stringify({ text: "x" }),
      createdAt: options.createdAt,
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
      createdAt: options.createdAt,
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
      createdAt: options.createdAt,
    })
    .run();
}

describe("storage report", () => {
  it("reports table volume and dry-run retention candidates", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        seed(opened.db, { id: "ses_old", createdAt: NOW - 200 * DAY, turnStatus: "COMPLETED" });
        seed(opened.db, { id: "ses_new", createdAt: NOW - 10 * DAY, turnStatus: "COMPLETED" });
        seed(opened.db, { id: "ses_live", createdAt: NOW - 200 * DAY, turnStatus: "RUNNING" });

        const report = storageReport(opened.db, { dataDir: dir, now: NOW });
        const byTable = new Map(report.tables.map((table) => [table.table, table]));

        expect(report.policy).toBe("dry_run");
        expect(report.activeSessions).toBe(1);
        expect(byTable.get("agent_events")).toMatchObject({
          rows: 3,
          retentionDays: 90,
          candidates: 1,
        });
        expect(byTable.get("turns")).toMatchObject({ rows: 3, retentionDays: 180, candidates: 1 });
        expect(byTable.get("session_context_summaries")).toMatchObject({
          rows: 3,
          retentionDays: 90,
          candidates: 1,
        });
        expect(report.candidates.total).toBe(3);
        expect(report.database.bytes).toBeGreaterThan(0);
      } finally {
        opened.close();
      }
    });
  });

  it("never selects rows from sessions with an active turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        seed(opened.db, { id: "ses_live", createdAt: NOW - 400 * DAY, turnStatus: "RUNNING" });

        const report = storageReport(opened.db, { dataDir: dir, now: NOW });

        expect(report.candidates.total).toBe(0);
        expect(report.activeSessions).toBe(1);
      } finally {
        opened.close();
      }
    });
  });
});
