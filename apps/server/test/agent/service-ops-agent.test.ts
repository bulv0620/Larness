import path from "node:path";
import { createFakeProvider, createFileToolRegistry } from "@larness/agent";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { disabledToolsForProfile } from "../../src/modules/agent/profiles.js";
import { createServiceOpsTools } from "../../src/modules/agent/serviceOpsTool.js";
import { executeTool } from "../../src/modules/agent/toolExecutor.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import type { ServiceOpsRuntime } from "../../src/modules/service-ops/serviceOps.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

it("exposes PM2 tools to coding without injecting a PM2 observation snapshot", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "larness.db"));
    runMigrations(opened.db);
    try {
      const session = await createSession(
        { db: opened.db, dataDir: dir },
        { agentProfile: "coding" },
      );
      const created = createTurn({ db: opened.db }, { sessionId: session.id, text: "deploy" });
      const sessionRow = getSessionById(opened.db, session.id);
      const turn = getTurnById(opened.db, created.turnId);
      if (!sessionRow || !turn) throw new Error("fixture missing");
      const registry = createFileToolRegistry();
      for (const tool of [
        ...createServiceOpsTools(),
        createObservationTool(),
        createCommandTool({}),
        createShellTool({}),
      ])
        registry.register(tool);
      const context = assembleContext(
        {
          db: opened.db,
          registry,
          maxContextTokens: 128_000,
          policy: "autonomous",
          agentProfile: "coding",
        },
        sessionRow,
        turn,
      );
      const names = context.tools.map(({ name }) => name);
      expect(names).toContain("list_service_ops");
      expect(names).toContain("control_service_ops");
      expect(names).toContain("run_command");
      expect(names).not.toContain("refresh_observations");
      expect(names).not.toContain("start_formal_service");
      expect(context.messages[0]?.content).toContain("PM2_HOME");
      expect(context.messages[0]?.content).not.toContain("PM2 runtime");
      const base = {
        sessionId: session.id,
        turnId: turn.id,
        toolCallId: "call",
        projectRoot: dir,
        policy: "autonomous" as const,
      };
      expect(
        await executeTool(
          { db: opened.db, registry, disabledTools: disabledToolsForProfile("coding") },
          { ...base, toolName: "refresh_observations", args: {} },
        ),
      ).toMatchObject({ status: "completed", result: { ok: false, errorCode: "TOOL_NOT_FOUND" } });
      expect(
        await executeTool(
          { db: opened.db, registry },
          { ...base, toolName: "build_formal_artifact", args: {} },
        ),
      ).toMatchObject({ status: "completed", result: { ok: false, errorCode: "TOOL_NOT_FOUND" } });
    } finally {
      opened.close();
    }
  });
});

it("routes service operations tools through the wired Turn runner", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "larness.db"));
    runMigrations(opened.db);
    try {
      const session = await createSession(
        { db: opened.db, dataDir: dir },
        { agentProfile: "coding" },
      );
      const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "list services" });
      const registry = createFileToolRegistry();
      for (const tool of createServiceOpsTools()) registry.register(tool);
      registry.register(createObservationTool());
      const provider = createFakeProvider([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: { id: "call_list", name: "list_service_ops", args: {} },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        {
          chunks: [
            { type: "text-delta", text: "listed" },
            {
              type: "finish",
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          ],
        },
      ]);
      const events: Array<{ type: string; payload: unknown }> = [];
      const serviceOps = {
        reconcile: async () => {},
        listServices: () => [{ targetId: "tgt_one" }],
        listUnassociatedServices: () => [],
      } as unknown as ServiceOpsRuntime;
      const runner = new TurnRunner({
        db: opened.db,
        dataDir: dir,
        registry,
        serviceOps,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
        publish: (event) => {
          if ("payload" in event) events.push({ type: event.type, payload: event.payload });
        },
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
      expect(
        events.find(
          (event) =>
            event.type === "tool.completed" &&
            (event.payload as { toolCallId?: string }).toolCallId === "call_list",
        )?.payload,
      ).toMatchObject({ resultSummary: "1 个 PM2 服务" });
    } finally {
      opened.close();
    }
  });
});
