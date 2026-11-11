import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Database } from "../../src/db/client.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent, listSessionEvents } from "../../src/modules/agent/events.js";
import { ResumeError, resumeInterruptedTurn } from "../../src/modules/agent/recovery/resume.js";
import { getTurnById, updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

const NOW = 1_800_000_000_000;

function seedTurnEvents(db: Database, sessionId: string, turnId: string): void {
  const add = (type: string, payload: Record<string, unknown>) =>
    appendAgentEvent(db, { sessionId, turnId, type, payload, now: NOW });

  add("user.message", { turnId, text: "修一下登录页" });
  add("tool.requested", {
    turnId,
    toolCallId: "c1",
    name: "run_command",
    argsSummary: "pnpm test",
  });
  add("tool.completed", {
    turnId,
    toolCallId: "c1",
    resultSummary: "Command COMPLETED; exit code 0",
  });
  add("tool.requested", { turnId, toolCallId: "c2", name: "apply_patch", argsSummary: "patch" });
  add("tool.completed", { turnId, toolCallId: "c2", resultSummary: "patched src/login.ts" });
  add("file.changed", { turnId, path: "src/login.ts", changeType: "modified", version: "abc123" });
  add("tool.requested", {
    turnId,
    toolCallId: "c3",
    name: "run_command",
    argsSummary: "pnpm test",
  });
  add("tool.failed", { turnId, toolCallId: "c3", errorCode: "COMMAND_FAILED", message: "exit 1" });
  add("plan.updated", {
    turnId,
    plan: {
      id: `plan_${turnId}`,
      title: "修复",
      steps: [
        { id: "s1", title: "定位", status: "done" },
        { id: "s2", title: "修复", status: "running" },
      ],
    },
  });
}

async function setup(dir: string, options: { interrupted: boolean; withFacts: boolean }) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const sessionOptions = { db: opened.db, dataDir: dir, now: () => NOW };
  const session = await createSession(sessionOptions, {});
  const created = createTurn(sessionOptions, { sessionId: session.id, text: "修一下登录页" });

  if (options.withFacts) {
    seedTurnEvents(opened.db, session.id, created.turnId);
  }

  updateTurnRow(opened.db, created.turnId, {
    status: options.interrupted ? "INTERRUPTED" : "COMPLETED",
    terminalReason: options.interrupted ? "interrupted" : "normal",
    endedAt: NOW,
  });

  return { opened, session, turnId: created.turnId };
}

describe("resume interrupted turn", () => {
  it("creates a new turn that carries verified facts and keeps the old one intact", async () => {
    await withTempDir(async (dir) => {
      const { opened, session, turnId } = await setup(dir, { interrupted: true, withFacts: true });

      try {
        const resumed = resumeInterruptedTurn(
          { db: opened.db, now: () => NOW },
          { turnId, clientSessionId: "cli_1" },
        );

        expect(resumed.resumedFromTurnId).toBe(turnId);
        expect(resumed.status).toBe("QUEUED");

        const created = getTurnById(opened.db, resumed.turnId);
        expect(created?.resumedFromTurnId).toBe(turnId);
        const input = JSON.parse(created?.inputJson ?? "{}") as { text?: string };
        expect(input.text).toContain("Work state checkpoint");
        expect(input.text).toContain("src/login.ts");
        expect(input.text).toContain("COMMAND_FAILED");
        expect(input.text).toContain("s2: 修复 (running)");

        const original = getTurnById(opened.db, turnId);
        expect(original?.status).toBe("INTERRUPTED");
        expect(original?.resumedFromTurnId).toBeNull();

        const events = listSessionEvents(opened.db, session.id).items;
        expect(events.some((event) => event.type === "turn.resumed")).toBe(true);

        // Repeating the call is idempotent and returns the same Turn.
        const again = resumeInterruptedTurn(
          { db: opened.db, now: () => NOW },
          { turnId, clientSessionId: "cli_1" },
        );
        expect(again.turnId).toBe(resumed.turnId);
      } finally {
        opened.close();
      }
    });
  });

  it("refuses a turn that is not interrupted", async () => {
    await withTempDir(async (dir) => {
      const { opened, turnId } = await setup(dir, { interrupted: false, withFacts: true });

      try {
        expect(() =>
          resumeInterruptedTurn({ db: opened.db, now: () => NOW }, { turnId }),
        ).toThrowError(ResumeError);
      } finally {
        opened.close();
      }
    });
  });

  it("refuses an interrupted turn without recoverable facts", async () => {
    await withTempDir(async (dir) => {
      const { opened, turnId } = await setup(dir, { interrupted: true, withFacts: false });

      try {
        let error: unknown;
        try {
          resumeInterruptedTurn({ db: opened.db, now: () => NOW }, { turnId });
        } catch (caught) {
          error = caught;
        }

        expect(error).toBeInstanceOf(ResumeError);
        expect((error as ResumeError).code).toBe("TURN_NOT_RESUMABLE");
        expect((error as ResumeError).message).toContain("no recoverable progress");
      } finally {
        opened.close();
      }
    });
  });

  it("reports a missing turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        expect(() =>
          resumeInterruptedTurn({ db: opened.db, now: () => NOW }, { turnId: "trn_missing" }),
        ).toThrowError(ResumeError);
      } finally {
        opened.close();
      }
    });
  });
});
