import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import {
  currentPlanText,
  latestPlan,
  openPlanSteps,
} from "../../src/modules/agent/turn/planState.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

function planPayload(
  turnId: string,
  steps: Array<{ id: string; title: string; status: "pending" | "running" | "done" | "failed" }>,
) {
  return {
    turnId,
    plan: {
      id: `plan_${turnId}`,
      kind: "plan",
      turnId,
      createdAt: 1,
      title: "修复问题",
      steps,
    },
  };
}

describe("plan state", () => {
  it("reads the latest plan, open steps and a bounded tail block", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(`${dir}/test.db`);
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const first = createTurn(options, { sessionId: session.id, text: "first" });
      appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: first.turnId,
        type: "plan.updated",
        payload: planPayload(first.turnId, [
          { id: "inspect", title: "检查", status: "done" },
          { id: "edit", title: "修改", status: "running" },
          { id: "verify", title: "验证", status: "pending" },
        ]),
        now: 1,
      });
      opened.sqlite.prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?").run(first.turnId);
      const current = createTurn(options, { sessionId: session.id, text: "second" });

      try {
        const latest = latestPlan(opened.db, session.id);
        expect(latest?.title).toBe("修复问题");
        expect(latest?.steps.map((step) => step.status)).toEqual(["done", "running", "pending"]);

        const text = currentPlanText(opened.db, session.id);
        expect(text).toContain("Current plan");
        expect(text).toContain("[running] 修改");
        expect(text).toContain("[pending] 验证");

        expect(openPlanSteps(opened.db, session.id, first.turnId)).toEqual([
          { id: "edit", title: "修改", status: "running" },
          { id: "verify", title: "验证", status: "pending" },
        ]);
        expect(openPlanSteps(opened.db, session.id, current.turnId)).toEqual([]);
      } finally {
        opened.close();
      }
    });
  });

  it("omits a fully completed plan and ignores malformed payloads", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(`${dir}/test.db`);
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const turn = createTurn(options, { sessionId: session.id, text: "done" });
      appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: turn.turnId,
        type: "plan.updated",
        payload: planPayload(turn.turnId, [{ id: "a", title: "完成", status: "done" }]),
        now: 1,
      });
      appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: turn.turnId,
        type: "plan.updated",
        payload: { plan: { steps: "bad" } },
        now: 2,
      });

      try {
        expect(latestPlan(opened.db, session.id)?.steps.map((step) => step.status)).toEqual([
          "done",
        ]);
        expect(currentPlanText(opened.db, session.id)).toBeNull();
        expect(openPlanSteps(opened.db, session.id, turn.turnId)).toEqual([]);
      } finally {
        opened.close();
      }
    });
  });
});
