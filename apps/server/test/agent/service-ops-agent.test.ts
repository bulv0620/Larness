import path from "node:path";
import { createFileToolRegistry, ToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createServiceOpsTools } from "../../src/modules/agent/serviceOpsTool.js";
import { executeTool } from "../../src/modules/agent/toolExecutor.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

function opsRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const tool of createServiceOpsTools()) registry.register(tool);
  return registry;
}

describe("service operations agent domain", () => {
  it("assembles a separate formal-service-only tool context", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: undefined },
        );
        const created = createTurn(
          { db: opened.db },
          {
            sessionId: session.id,
            text: "restart the formal service",
            executionContext: {
              domain: "service-ops",
              targetId: "tgt_00000000-0000-4000-8000-000000000001",
            },
          },
        );
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");
        const ops = opsRegistry();
        const context = assembleContext(
          {
            db: opened.db,
            registry: ops,
            maxContextTokens: 128_000,
            policy: "autonomous",
            domain: "service-ops",
            opsTargetId: "tgt_00000000-0000-4000-8000-000000000001",
          },
          sessionRow,
          turn,
        );
        const names = context.tools.map((tool) => tool.name).sort();
        expect(names).toEqual([
          "list_formal_services",
          "read_formal_service_logs",
          "restart_formal_service",
          "start_formal_service",
          "stop_formal_service",
        ]);
        expect(context.messages[0]?.content).toContain("service operations agent");
        expect(context.messages[0]?.content).toContain("tgt_00000000-0000-4000-8000-000000000001");
        expect(context.messages[0]?.content).toContain("Version changes require a deployment plan");
        expect(names).not.toContain("read_file");

        const dev = createFileToolRegistry();
        const devContext = assembleContext(
          { db: opened.db, registry: dev, maxContextTokens: 128_000, policy: "autonomous" },
          sessionRow,
          turn,
        );
        expect(devContext.tools.map((tool) => tool.name)).not.toContain("list_formal_services");
        expect(devContext.tools.map((tool) => tool.name)).toContain("read_file");
      } finally {
        opened.close();
      }
    });
  });

  it("rejects direct cross-domain tool calls in both directions", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: undefined },
        );
        const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "cross domain" });
        const base = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_cross",
          args: {},
          policy: "autonomous" as const,
          projectRoot: dir,
          clientSessionId: "client",
          policySnapshotId: "psnap",
        };
        const ops = await executeTool(
          { db: opened.db, registry: opsRegistry() },
          { ...base, toolName: "read_file" },
        );
        expect(ops).toMatchObject({
          status: "completed",
          result: { ok: false, errorCode: "TOOL_NOT_FOUND" },
        });
        const dev = await executeTool(
          { db: opened.db, registry: createFileToolRegistry() },
          { ...base, toolName: "list_formal_services" },
        );
        expect(dev).toMatchObject({
          status: "completed",
          result: { ok: false, errorCode: "TOOL_NOT_FOUND" },
        });
        const opsTool = await executeTool(
          { db: opened.db, registry: opsRegistry() },
          { ...base, toolName: "list_formal_services" },
        );
        expect(opsTool).toMatchObject({
          status: "completed",
          result: { ok: false, errorCode: "FORBIDDEN" },
        });
      } finally {
        opened.close();
      }
    });
  });

  it("rejects forged operations scope from a development turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: undefined },
        );
        const turn = createTurn({ db: opened.db }, { sessionId: session.id, text: "dev only" });
        const result = await executeTool(
          { db: opened.db, registry: createFileToolRegistry() },
          {
            sessionId: session.id,
            turnId: turn.turnId,
            toolCallId: "call_forged",
            toolName: "restart_formal_service",
            args: { targetId: "tgt_00000000-0000-4000-8000-000000000001" },
            policy: "autonomous",
            projectRoot: dir,
            clientSessionId: "client",
            policySnapshotId: "psnap",
          },
        );
        expect(result).toMatchObject({
          status: "completed",
          result: { ok: false, errorCode: "TOOL_NOT_FOUND" },
        });
      } finally {
        opened.close();
      }
    });
  });
});
