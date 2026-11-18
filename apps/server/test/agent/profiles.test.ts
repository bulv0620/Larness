import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createGitTools } from "../../src/modules/agent/gitTool.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import {
  DEFAULT_AGENT_PROFILE,
  TOOL_PACK_CATALOG,
  toolNamesForProfile,
} from "../../src/modules/agent/profiles.js";
import { createServiceTools } from "../../src/modules/agent/serviceTool.js";
import { createTerminalControlTools } from "../../src/modules/agent/terminalControlTool.js";
import { createTerminalTools } from "../../src/modules/agent/terminalTool.js";
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

describe("agent profile assembly", () => {
  it("exposes the existing 28-tool surface as workspace and a core-only coding surface", async () => {
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
          ...createTerminalTools({ db: opened.db }),
          ...createTerminalControlTools({ db: opened.db }),
          ...createGitTools(),
          ...createServiceTools(),
          createObservationTool(),
        ]) {
          registry.register(tool);
        }

        const assemble = (agentProfile: "coding" | "plan" | "workspace") =>
          assembleContext(
            {
              db: opened.db,
              registry,
              maxContextTokens: 128_000,
              policy: "standard",
              workspaceRoot: root,
              agentProfile,
            },
            sessionRow,
            turn,
          );

        const workspace = assemble("workspace");
        const coding = assemble("coding");
        const plan = assemble("plan");

        expect(DEFAULT_AGENT_PROFILE).toBe("workspace");
        expect(workspace.agentProfile).toBe("workspace");
        expect(workspace.tools).toHaveLength(28);
        expect(workspace.tools.map((tool) => tool.name)).toContain("git_status");
        expect(workspace.tools.map((tool) => tool.name)).toContain("start_project_terminal");

        expect(coding.tools.map((tool) => tool.name)).toEqual([
          "apply_patch",
          "list_files",
          "read_file",
          "run_command",
          "search_code",
          "write_file",
        ]);
        expect(coding.tools.some((tool) => tool.name.startsWith("git_"))).toBe(false);
        expect(coding.tools.some((tool) => tool.name.includes("terminal"))).toBe(false);
        expect(coding.tools.some((tool) => tool.name === "update_plan")).toBe(false);
        expect(coding.estimatedTokens).toBeLessThan(workspace.estimatedTokens);

        expect(plan.tools.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "search_code",
          "update_plan",
        ]);
        expect(plan.tools.some((tool) => tool.name === "write_file")).toBe(false);
        expect(plan.tools.some((tool) => tool.name === "run_command")).toBe(false);

        // The same Session can be assembled with both surfaces without mutating it.
        expect(sessionRow.id).toBe(session.id);
        expect([...toolNamesForProfile("workspace")]).toHaveLength(28);
        expect([...toolNamesForProfile("coding")]).toHaveLength(6);
        expect(TOOL_PACK_CATALOG.profiles.coding.packs).toEqual([
          "core.read",
          "core.write",
          "core.command",
        ]);
      } finally {
        opened.close();
      }
    });
  });

  it("drops project-only tools for a workspace without a registered project", async () => {
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
        for (const tool of [
          createPlanTool({ db: opened.db }),
          createCommandTool({}),
          ...createTerminalTools({ db: opened.db }),
          ...createTerminalControlTools({ db: opened.db }),
          ...createGitTools(),
          ...createServiceTools(),
          createObservationTool(),
        ]) {
          registry.register(tool);
        }

        const context = assembleContext(
          {
            db: opened.db,
            registry,
            maxContextTokens: 128_000,
            policy: "standard",
            agentProfile: "workspace",
          },
          sessionRow,
          turn,
        );
        const names = context.tools.map((tool) => tool.name);

        expect(names).not.toContain("git_status");
        expect(names).not.toContain("register_temporary_service");
        expect(names).toContain("read_file");
        expect(names).toContain("run_command");
      } finally {
        opened.close();
      }
    });
  });
});
