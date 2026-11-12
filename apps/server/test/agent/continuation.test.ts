import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent, listSessionEvents } from "../../src/modules/agent/events.js";
import { continueBudgetedTurn } from "../../src/modules/agent/recovery/continue.js";
import {
  createSessionRow,
  getTurnById,
  updateTurnRow,
} from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

const NOW = 1_800_000_000_000;

function finishAsBudget(
  opened: ReturnType<typeof openDatabase>,
  sessionId: string,
  turnId: string,
): void {
  appendAgentEvent(opened.db, {
    sessionId,
    turnId,
    type: "file.changed",
    payload: { path: "a.ts", changeType: "modified", version: "v1" },
    now: NOW,
  });
  updateTurnRow(opened.db, turnId, {
    status: "COMPLETED",
    terminalReason: "budget",
    endedAt: NOW,
  });
}

describe("automatic continuation", () => {
  it("starts a new turn carrying facts and records the chain", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const first = createTurn(options, { sessionId: session.id, text: "long task" });
        finishAsBudget(opened, session.id, first.turnId);

        const next = continueBudgetedTurn(
          { db: opened.db, now: () => NOW },
          {
            turnId: first.turnId,
          },
        );

        expect(next).toMatchObject({ fromTurnId: first.turnId, depth: 1 });
        const created = getTurnById(opened.db, next?.turnId ?? "");
        expect(created?.resumedFromTurnId).toBe(first.turnId);
        const input = JSON.parse(created?.inputJson ?? "{}") as { text?: string };
        expect(input.text).toContain("Work state checkpoint");
        expect(input.text).toContain("a.ts");

        const events = listSessionEvents(opened.db, session.id).items;
        expect(events.some((event) => event.type === "turn.continued")).toBe(true);

        // Repeating the call is idempotent: the same continuation turn comes back.
        const again = continueBudgetedTurn(
          { db: opened.db, now: () => NOW },
          {
            turnId: first.turnId,
          },
        );
        expect(again?.turnId).toBe(next?.turnId);
      } finally {
        opened.close();
      }
    });
  });

  it("stops the chain after the configured depth", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        let turnId = createTurn(options, { sessionId: session.id, text: "chain" }).turnId;

        for (let depth = 1; depth <= 3; depth += 1) {
          finishAsBudget(opened, session.id, turnId);
          const next = continueBudgetedTurn(
            { db: opened.db, now: () => NOW, maxContinuations: 3 },
            {
              turnId,
            },
          );

          expect(next?.depth).toBe(depth);
          turnId = next?.turnId ?? "";
        }

        finishAsBudget(opened, session.id, turnId);
        expect(
          continueBudgetedTurn({ db: opened.db, now: () => NOW, maxContinuations: 3 }, { turnId }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("never chains scheduled sessions or non-budget turns", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const scheduled = createSessionRow(opened.db, {
          id: "ses_scheduled",
          projectId: null,
          workspacePath: dir,
          title: "job",
          origin: "scheduled",
          modelProfileId: null,
          approvalPolicyId: "readonly",
          now: NOW,
        });
        const jobTurn = createTurn(options, { sessionId: scheduled.id, text: "job task" });
        finishAsBudget(opened, scheduled.id, jobTurn.turnId);
        expect(
          continueBudgetedTurn({ db: opened.db, now: () => NOW }, { turnId: jobTurn.turnId }),
        ).toBeNull();

        const session = await createSession(options, {});
        const normal = createTurn(options, { sessionId: session.id, text: "normal" });
        updateTurnRow(opened.db, normal.turnId, { status: "COMPLETED", terminalReason: "normal" });
        expect(
          continueBudgetedTurn({ db: opened.db, now: () => NOW }, { turnId: normal.turnId }),
        ).toBeNull();

        const empty = createTurn(options, { sessionId: session.id, text: "nothing yet" });
        updateTurnRow(opened.db, empty.turnId, { status: "COMPLETED", terminalReason: "budget" });
        expect(
          continueBudgetedTurn({ db: opened.db, now: () => NOW }, { turnId: empty.turnId }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });
});
