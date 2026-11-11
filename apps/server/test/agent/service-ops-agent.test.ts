import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { executeTool } from "../../src/modules/agent/toolExecutor.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

it("provides PM2 environment and project associations to the normal command context", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "larness.db"));
    runMigrations(opened.db);
    try {
      const session = await createSession({ db: opened.db, dataDir: dir }, {});
      const created = createTurn({ db: opened.db }, { sessionId: session.id, text: "deploy" });
      const sessionRow = getSessionById(opened.db, session.id);
      const turn = getTurnById(opened.db, created.turnId);
      if (!sessionRow || !turn) throw new Error("fixture missing");
      const registry = createFileToolRegistry();
      registry.register(createCommandTool({}));
      const context = assembleContext(
        {
          db: opened.db,
          registry,
          maxContextTokens: 128_000,
          policy: "autonomous",
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
      expect(context.tools.map(({ name }) => name)).toContain("run_command");
      expect(context.tools.map(({ name }) => name)).not.toContain("start_formal_service");
      expect(context.messages[0]?.content).toContain("/global/pm2/bin/pm2");
      expect(context.messages[0]?.content).toContain("larness:prj_one:api");
      expect(context.messages[0]?.content).toContain("PM2_HOME");
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
      ).toMatchObject({ status: "completed", result: { ok: false, errorCode: "FORBIDDEN" } });
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
