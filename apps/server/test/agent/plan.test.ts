import path from "node:path";
import { createFakeProvider, createFileToolRegistry } from "@larness/agent";
import type { ServerEvent } from "@larness/shared";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listSessionEvents } from "../../src/modules/agent/events.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

it("persists each real plan update before publishing and replays the same turn plan", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    try {
      const session = await createSession({ db: opened.db, dataDir: dir }, {});
      const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "multi step" });
      const registry = createFileToolRegistry();
      registry.register(createPlanTool({ db: opened.db }));
      const steps = [
        { id: "inspect", title: "检查", status: "running" },
        { id: "verify", title: "验证", status: "pending" },
      ];
      const provider = createFakeProvider([
        ...[
          steps,
          [
            { ...steps[0], status: "done" },
            { ...steps[1], status: "running" },
          ],
        ].map((value, index) => ({
          chunks: [
            {
              type: "tool-call" as const,
              toolCall: {
                id: `call_${index}`,
                name: "update_plan",
                args: { title: "修复问题", steps: value },
              },
            },
            { type: "finish" as const, finishReason: "tool-calls" as const },
          ],
        })),
        {
          chunks: [
            { type: "text-delta", text: "已完成检查，验证未完成。" },
            { type: "finish", finishReason: "stop" },
          ],
        },
      ]);
      const published: ServerEvent[] = [];
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
        publish: (event) => {
          if (!("sequence" in event) || event.type !== "plan.updated") return;
          expect(
            listSessionEvents(opened.db, session.id).items.some(
              (row) => row.eventId === event.eventId,
            ),
          ).toBe(true);
          published.push(event);
        },
      });
      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
      expect(published).toHaveLength(2);
      const plans = published.map(
        (event) => (event.payload as { plan: { id: string; steps: typeof steps } }).plan,
      );
      expect(plans[0]?.id).toBe(plans[1]?.id);
      expect(plans[1]?.steps.map((step) => step.status)).toEqual(["done", "running"]);
      expect(published[1]?.payload).toMatchObject({
        turnId: turn.turnId,
        plan: { turnId: turn.turnId },
      });
      expect(provider.calls[0]?.messages[0]?.content).toContain("update_plan");
      expect(
        listSessionEvents(opened.db, session.id).items.filter((row) => row.type === "plan.updated"),
      ).toEqual(published);
    } finally {
      opened.close();
    }
  });
});

it("rejects duplicate IDs, multiple running steps, invalid/oversized plans and unavailable context", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    try {
      const tool = createPlanTool({ db: opened.db });
      const step = { id: "a", title: "检查", status: "running" };
      for (const steps of [
        [step, step],
        [step, { ...step, id: "b" }],
        [],
        Array.from({ length: 13 }, (_, i) => ({ ...step, id: String(i), status: "pending" })),
        [{ ...step, status: "invented" }],
      ]) {
        expect(await tool.execute({ title: "计划", steps }, { projectRoot: dir })).toMatchObject({
          ok: false,
          errorCode: "VALIDATION_ERROR",
        });
      }
      expect(
        await tool.execute({ title: "计划", steps: [step] }, { projectRoot: dir }),
      ).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
    } finally {
      opened.close();
    }
  });
});

it("does not write a plan after cancellation and refuses known credentials", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    try {
      const { SecretStore } = await import("../../src/security/secretStore.js");
      const { createCredential } = await import("../../src/modules/models/service.js");
      const store = await SecretStore.open(dir);
      createCredential(
        { db: opened.db, secretStore: store },
        {
          provider: "deepseek",
          label: "test",
          apiKey: "sk-plan-private-value",
          clientSessionId: "bs_test",
        },
      );
      const tool = createPlanTool({ db: opened.db, secretStore: store });
      expect(
        await tool.execute(
          {
            title: "sk-plan-private-value",
            steps: [{ id: "a", title: "check", status: "running" }],
          },
          { projectRoot: dir },
        ),
      ).toMatchObject({ errorCode: "VALIDATION_ERROR" });
      const session = await createSession({ db: opened.db, dataDir: dir }, {});
      const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "cancel" });
      const registry = createFileToolRegistry();
      registry.register(tool);
      const provider = createFakeProvider([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "plan_call",
                name: "update_plan",
                args: { title: "计划", steps: [{ id: "a", title: "检查", status: "running" }] },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
        publish: (event) => {
          if ("type" in event && event.type === "tool.started") runner.cancel(turn.turnId);
        },
      });
      expect((await runner.run(turn.turnId)).status).toBe("CANCELLED");
      const events = listSessionEvents(opened.db, session.id).items;
      expect(events.some((event) => event.type === "plan.updated")).toBe(false);
      expect(JSON.stringify(events)).not.toContain("sk-plan-private-value");
    } finally {
      opened.close();
    }
  });
});
