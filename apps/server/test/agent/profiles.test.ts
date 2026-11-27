import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createMemoryTools } from "../../src/modules/agent/memoryTool.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import { createProcessTools } from "../../src/modules/agent/processTool.js";
import {
  DEFAULT_AGENT_PROFILE,
  TOOL_PACK_CATALOG,
  toolNamesForProfile,
} from "../../src/modules/agent/profiles.js";
import { createServiceOpsTools } from "../../src/modules/agent/serviceOpsTool.js";
import { createProject } from "../../src/modules/projects/service.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

function openWorkspace(dir: string): OpenedDatabase {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

const codingTools = [
  "apply_patch",
  "control_service_ops",
  "edit",
  "list_files",
  "list_processes",
  "list_service_ops",
  "read_file",
  "read_memory",
  "read_process_output",
  "read_service_ops_logs",
  "remember",
  "run_command",
  "run_shell",
  "search_code",
  "start_process",
  "stop_process",
  "write_file",
];

const fullPacks = [
  "core.read",
  "core.write",
  "core.command",
  "process",
  "serviceOps",
  "memory",
  "web",
  "attachments",
] as const;

describe("agent profile assembly", () => {
  it("gives coding and plan the full tool surface and only plan the plan tool", async () => {
    await withTempDir(async (dir) => {
      const opened = openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const created = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "profile test",
        });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const registry = createFileToolRegistry();
        for (const tool of [
          createPlanTool({ db: opened.db }),
          createCommandTool({}),
          createShellTool({}),
          ...createProcessTools({}),
          ...createServiceOpsTools(),
          ...createMemoryTools(),
          createObservationTool(),
        ])
          registry.register(tool);

        const assemble = (agentProfile: "coding" | "plan") =>
          assembleContext(
            {
              db: opened.db,
              registry,
              maxContextTokens: 128_000,
              policy: "standard",
              agentProfile,
            },
            sessionRow,
            turn,
          );

        const coding = assemble("coding");
        const plan = assemble("plan");

        expect(DEFAULT_AGENT_PROFILE).toBe("coding");
        const codingSystem = coding.messages[0]?.content ?? "";
        const planSystem = plan.messages[0]?.content ?? "";

        expect(coding.agentProfile).toBe("coding");
        expect(coding.tools.map((tool) => tool.name)).toEqual(codingTools);
        expect(codingSystem).not.toContain("update_plan");
        expect(codingSystem).toContain("Project background task contract");
        expect(codingSystem).toContain("Persistent PM2 service contract");
        expect(codingSystem).toContain("isolated PM2_HOME");
        expect(codingSystem).toContain("Match verification to the change");
        expect(codingSystem).not.toContain("PM2 runtime");

        expect(plan.tools.map((tool) => tool.name)).toEqual(
          [...codingTools, "update_plan"].sort((left, right) => left.localeCompare(right)),
        );
        expect(planSystem).toContain("update_plan");
        expect(planSystem).toContain("For complex multi-step tasks");
        expect(planSystem).toContain("Match verification to the change");

        expect([...toolNamesForProfile("coding")]).toHaveLength(22);
        expect([...toolNamesForProfile("plan")]).toHaveLength(23);
        expect(TOOL_PACK_CATALOG.profiles.coding.packs).toEqual([...fullPacks]);
        expect(TOOL_PACK_CATALOG.profiles.plan.packs).toEqual([...fullPacks, "plan"]);
        expect(Object.keys(TOOL_PACK_CATALOG.profiles).sort()).toEqual(["coding", "plan"]);
      } finally {
        opened.close();
      }
    });
  });

  it("drops project-only tools when no project is registered", async () => {
    await withTempDir(async (dir) => {
      const opened = openWorkspace(dir);
      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const created = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "no project",
        });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const registry = createFileToolRegistry();
        for (const tool of [createCommandTool({}), createShellTool({}), ...createProcessTools({})])
          registry.register(tool);

        const context = assembleContext(
          {
            db: opened.db,
            registry,
            maxContextTokens: 128_000,
            policy: "standard",
            agentProfile: "coding",
          },
          sessionRow,
          turn,
        );
        const names = context.tools.map((tool) => tool.name);

        expect(names).not.toContain("start_process");
        expect(names).not.toContain("list_processes");
        expect(names).toContain("read_file");
        expect(names).toContain("run_command");
      } finally {
        opened.close();
      }
    });
  });
});
