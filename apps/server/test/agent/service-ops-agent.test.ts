import path from "node:path";
import { createFakeProvider, createFileToolRegistry } from "@larness/agent";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createServiceOpsTools } from "../../src/modules/agent/serviceOpsTool.js";
import { executeTool } from "../../src/modules/agent/toolExecutor.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import type { ServiceOpsRuntime } from "../../src/modules/service-ops/serviceOps.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

it("provides PM2 environment and project associations to the normal command context", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "larness.db"));
    runMigrations(opened.db);
    try {
      const session = await createSession(
        { db: opened.db, dataDir: dir },
        { agentProfile: "service-ops" },
      );
      const created = createTurn({ db: opened.db }, { sessionId: session.id, text: "deploy" });
      const sessionRow = getSessionById(opened.db, session.id);
      const turn = getTurnById(opened.db, created.turnId);
      if (!sessionRow || !turn) throw new Error("fixture missing");
      const registry = createFileToolRegistry();
      for (const tool of createServiceOpsTools()) registry.register(tool);
      registry.register(createObservationTool());
      const context = assembleContext(
        {
          db: opened.db,
          registry,
          maxContextTokens: 128_000,
          policy: "autonomous",
          agentProfile: "service-ops",
          pm2Context: {
            available: true,
            nodeExecutable: process.execPath,
            entry: "/global/pm2/bin/pm2",
            version: "7.1.2",
            home: path.join(dir, "pm2"),
            namespace: "larness",
            serviceNamePattern: "larness:<projectId>:<serviceKey>",
            project: null,
            services: [
              {
                projectId: "prj_one",
                projectName: "One",
                name: "api",
                pm2Name: "larness:prj_one:api",
                observedState: "running",
                pid: 1234,
                updatedAt: 1,
              },
            ],
          },
        },
        sessionRow,
        turn,
      );
      expect(context.tools.map(({ name }) => name)).toContain("list_service_ops");
      expect(context.tools.map(({ name }) => name)).toContain("control_service_ops");
      expect(context.tools.map(({ name }) => name)).not.toContain("run_command");
      expect(context.tools.map(({ name }) => name)).not.toContain("start_formal_service");
      expect(context.messages[0]?.content).toContain("PM2_HOME");
      // The runtime snapshot changes with the deployment, so it travels after
      // the request instead of inside the cacheable system prefix.
      expect(context.observations).toContain("/global/pm2/bin/pm2");
      expect(context.observations).toContain("larness:prj_one:api");
      const base = {
        sessionId: session.id,
        turnId: turn.id,
        toolCallId: "call",
        projectRoot: dir,
        policy: "readonly" as const,
      };
      expect(
        await executeTool(
          { db: opened.db, registry },
          {
            ...base,
            toolName: "run_command",
            args: { executable: "pm2", args: ["restart", "api"] },
          },
        ),
      ).toMatchObject({ status: "completed", result: { ok: false, errorCode: "TOOL_NOT_FOUND" } });
      expect(
        await executeTool(
          { db: opened.db, registry },
          { ...base, policy: "autonomous", toolName: "build_formal_artifact", args: {} },
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
        { agentProfile: "service-ops" },
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
