import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import type { Pm2CommandContext } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import {
  DEFAULT_AGENT_PROFILE,
  TOOL_PACK_CATALOG,
  toolNamesForProfile,
} from "../../src/modules/agent/profiles.js";
import { createServiceTools } from "../../src/modules/agent/serviceTool.js";
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
          createShellTool({}),
          ...createServiceTools(),
          createObservationTool(),
        ]) {
          registry.register(tool);
        }

        const pm2Context: Pm2CommandContext = {
          available: true,
          nodeExecutable: "/usr/bin/node",
          entry: null,
          version: "7.1.2",
          home: path.join(dir, "pm2"),
          namespace: "larness",
          serviceNamePattern: "larness:<projectId>:<serviceKey>",
          project: {
            id: project.id,
            name: "project",
            root,
            releaseRoot: path.join(root, ".larness"),
          },
          services: [],
        };
        const assemble = (agentProfile: "coding" | "plan" | "workspace") =>
          assembleContext(
            {
              db: opened.db,
              registry,
              maxContextTokens: 128_000,
              policy: "standard",
              agentProfile,
              pm2Context,
            },
            sessionRow,
            turn,
          );

        const workspace = assemble("workspace");
        const coding = assemble("coding");
        const plan = assemble("plan");

        expect(DEFAULT_AGENT_PROFILE).toBe("workspace");
        const workspaceSystem = workspace.messages[0]?.content ?? "";
        const codingSystem = coding.messages[0]?.content ?? "";
        const planSystem = plan.messages[0]?.content ?? "";

        expect(workspace.agentProfile).toBe("workspace");
        expect(workspace.tools).toHaveLength(12);
        expect(workspace.tools.map((tool) => tool.name)).toContain("list_services");
        expect(workspace.tools.some((tool) => tool.name.startsWith("git_"))).toBe(false);
        expect(workspace.tools.some((tool) => tool.name.includes("terminal"))).toBe(false);
        expect(workspaceSystem).toContain("Larness prompt version: m6-5.");
        expect(workspaceSystem).toContain("update_plan in the same batch");
        expect(workspaceSystem).toContain("Service lifecycle contract");
        expect(workspaceSystem).not.toContain("Git availability");
        expect(workspaceSystem).toContain("globally installed PM2");
        expect(workspaceSystem).not.toContain("terminal input leases");
        expect(workspace.observations).toContain("PM2 runtime and service/project associations");

        expect(codingSystem).toContain("Larness prompt version: m6-5.");
        expect(codingSystem).not.toContain("update_plan");
        expect(codingSystem).not.toContain("Service lifecycle contract");
        expect(codingSystem).not.toContain("Git availability");
        expect(codingSystem).not.toContain("globally installed PM2");
        expect(codingSystem).not.toContain("terminal input leases");
        expect(codingSystem).not.toContain("development_preview");
        expect(codingSystem).not.toContain("persistent_pm2");
        expect(coding.observations).toBeNull();
        expect(planSystem).not.toContain("Service lifecycle contract");
        expect(planSystem).not.toContain("Git availability");
        expect(planSystem).not.toContain("globally installed PM2");
        expect(plan.observations).toBeNull();

        expect(coding.tools.map((tool) => tool.name)).toEqual([
          "apply_patch",
          "list_files",
          "read_file",
          "run_command",
          "run_shell",
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
        expect([...toolNamesForProfile("workspace")]).toHaveLength(12);
        expect([...toolNamesForProfile("coding")]).toHaveLength(7);
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
          createShellTool({}),
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
