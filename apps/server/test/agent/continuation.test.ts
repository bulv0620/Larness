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
  usage: Record<string, number> = { inputTokens: 400_000, outputTokens: 100_000 },
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
    // A slice that hit the token cap always reports what it spent, and the
    // chain reads this column to carry the cap across slices (ADR-059).
    usageJson: JSON.stringify(usage),
  });
}

function finishAsContinued(
  opened: ReturnType<typeof openDatabase>,
  _sessionId: string,
  turnId: string,
): void {
  updateTurnRow(opened.db, turnId, {
    status: "COMPLETED",
    terminalReason: "continued",
    endedAt: NOW,
  });
}

describe("automatic continuation", () => {
  it("continues a context rollover with a fallback when there are no tool facts", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const first = createTurn(options, { sessionId: session.id, text: "analyze this" });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: first.turnId,
          type: "assistant.message",
          payload: { turnId: first.turnId, messageId: "msg_1", text: "intermediate conclusion" },
          now: NOW,
        });
        finishAsContinued(opened, session.id, first.turnId);

        const next = continueBudgetedTurn(
          { db: opened.db, now: () => NOW },
          { turnId: first.turnId },
        );

        expect(next).toMatchObject({ fromTurnId: first.turnId, depth: 1 });
        const created = getTurnById(opened.db, next?.turnId ?? "");
        expect(created?.resumedFromTurnId).toBe(first.turnId);
        const input = JSON.parse(created?.inputJson ?? "{}") as { text?: string };
        expect(input.text).toContain("Work state checkpoint");
        expect(input.text).toContain("fallback");
        expect(input.text).toContain("intermediate conclusion");
        const events = listSessionEvents(opened.db, session.id).items;
        expect(events.some((event) => event.type === "turn.continued")).toBe(true);
      } finally {
        opened.close();
      }
    });
  });

  it("carries the originating client session into the continuation turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const first = createTurn(options, {
          sessionId: session.id,
          text: "continue with commands",
          clientSessionId: "bs_original",
        });
        finishAsContinued(opened, session.id, first.turnId);

        const next = continueBudgetedTurn(
          { db: opened.db, now: () => NOW },
          { turnId: first.turnId },
        );
        const created = getTurnById(opened.db, next?.turnId ?? "");
        const input = JSON.parse(created?.inputJson ?? "{}") as {
          executionContext?: { clientSessionId?: string };
        };
        expect(input.executionContext?.clientSessionId).toBe("bs_original");
      } finally {
        opened.close();
      }
    });
  });

  it("does not impose the old three-slice cap by default", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        let turnId = createTurn(options, { sessionId: session.id, text: "very long chain" }).turnId;

        for (let depth = 1; depth <= 5; depth += 1) {
          finishAsContinued(opened, session.id, turnId);
          const next = continueBudgetedTurn({ db: opened.db, now: () => NOW }, { turnId });

          expect(next?.depth).toBe(depth);
          turnId = next?.turnId ?? "";
        }
      } finally {
        opened.close();
      }
    });
  });

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
            budgetCause: "tokens",
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
            budgetCause: "tokens",
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
              budgetCause: "tokens",
            },
          );

          expect(next?.depth).toBe(depth);
          turnId = next?.turnId ?? "";
        }

        finishAsBudget(opened, session.id, turnId);
        expect(
          continueBudgetedTurn(
            { db: opened.db, now: () => NOW, maxContinuations: 3 },
            { turnId, budgetCause: "tokens" },
          ),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("does not chain a slice that spent nothing", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "end of chain" });
        // Stopping before the first model call proves the inherited cap is
        // already spent: another slice would only append an empty turn.
        finishAsBudget(opened, session.id, turn.turnId, {});

        expect(
          continueBudgetedTurn(
            { db: opened.db, now: () => NOW },
            { turnId: turn.turnId, budgetCause: "tokens" },
          ),
        ).toBeNull();

        // Context pressure before the first model call is an unshrinkable-input
        // stop: chaining the same input would only create another empty slice.
        expect(
          continueBudgetedTurn(
            { db: opened.db, now: () => NOW },
            { turnId: turn.turnId, budgetCause: "context" },
          ),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("does not continue a turn that stopped on the stall guard", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "stalled" });
        finishAsBudget(opened, session.id, turn.turnId);

        expect(
          continueBudgetedTurn(
            { db: opened.db, now: () => NOW },
            { turnId: turn.turnId, budgetCause: "duration" },
          ),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("continues a read-only slice because reads are recorded facts", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => NOW };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "audit the module" });

        // Only reads: no file was written and no command ran. This used to mean
        // "no facts", so an audit Turn could not be continued at all.
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: turn.turnId,
          type: "tool.requested",
          payload: { turnId: turn.turnId, toolCallId: "r1", name: "read_file" },
          now: NOW,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: turn.turnId,
          type: "tool.completed",
          payload: {
            turnId: turn.turnId,
            toolCallId: "r1",
            resultSummary: "read src/pay.ts",
            fileRead: { path: "src/pay.ts", version: "v9" },
          },
          now: NOW,
        });
        updateTurnRow(opened.db, turn.turnId, {
          status: "COMPLETED",
          terminalReason: "budget",
          endedAt: NOW,
          usageJson: JSON.stringify({ inputTokens: 400_000, outputTokens: 100_000 }),
        });

        const next = continueBudgetedTurn(
          { db: opened.db, now: () => NOW },
          { turnId: turn.turnId, budgetCause: "context" },
        );

        expect(next).not.toBeNull();
        const created = getTurnById(opened.db, next?.turnId ?? "");
        const input = JSON.parse(created?.inputJson ?? "{}") as { text?: string };
        expect(input.text).toContain("src/pay.ts");
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
      } finally {
        opened.close();
      }
    });
  });
});
