import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listSessionEvents } from "../../src/modules/agent/events.js";
import { repairInterruptedTurns } from "../../src/modules/agent/repair.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

const ACTIVE_STATUSES = [
  "QUEUED",
  "PREPARING",
  "RUNNING",
  "WAITING_APPROVAL",
  "CANCELLING",
] as const;

describe("repairInterruptedTurns", () => {
  it("marks every active turn as INTERRUPTED and appends one event per turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const sessions = [];

        for (const status of ACTIVE_STATUSES) {
          const session = await createSession(options, {});
          const turn = createTurn(options, { sessionId: session.id, text: status });
          opened.sqlite
            .prepare("UPDATE turns SET status = ? WHERE id = ?")
            .run(status, turn.turnId);
          sessions.push({ session, turnId: turn.turnId, status });
        }

        const completedSession = await createSession(options, {});
        const completed = createTurn(options, {
          sessionId: completedSession.id,
          text: "done",
        });
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(completed.turnId);

        expect(repairInterruptedTurns({ db: opened.db, now: () => 9_000 })).toBe(5);

        for (const entry of sessions) {
          const row = opened.sqlite
            .prepare("SELECT status, ended_at, error_json FROM turns WHERE id = ?")
            .get(entry.turnId) as {
            status: string;
            ended_at: number | null;
            error_json: string | null;
          };
          expect(row.status).toBe("INTERRUPTED");
          expect(row.ended_at).toBe(9_000);
          expect(JSON.parse(row.error_json ?? "{}")).toMatchObject({ code: "INTERRUPTED" });

          const events = listSessionEvents(opened.db, entry.session.id).items;
          expect(events.map((event) => event.type)).toEqual([
            "user.message",
            "turn.created",
            "turn.interrupted",
          ]);
          expect(events[2]?.payload).toMatchObject({ turnId: entry.turnId });
        }

        const completedRow = opened.sqlite
          .prepare("SELECT status FROM turns WHERE id = ?")
          .get(completed.turnId) as { status: string };
        expect(completedRow.status).toBe("COMPLETED");

        const eventCount = opened.sqlite.prepare("SELECT count(*) AS n FROM agent_events").get();
        expect(repairInterruptedTurns({ db: opened.db, now: () => 9_500 })).toBe(0);
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM agent_events").get()).toEqual(
          eventCount,
        );
      } finally {
        opened.close();
      }
    });
  });
});
