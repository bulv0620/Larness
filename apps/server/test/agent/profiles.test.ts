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
import { createProcessTools } from "../../src/modules/agent/processTool.js";
import {
  DEFAULT_AGENT_PROFILE,
  TOOL_PACK_CATALOG,
  toolNamesForProfile,
} from "../../src/modules/agent/profiles.js";
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
  it("puts background processes in coding and keeps service-ops for PM2", async () => {
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
          createObservationTool(),
        ])
          registry.register(tool);

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
        const assemble = (agentProfile: "coding" | "plan" | "service-ops") =>
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

        const coding = assemble("coding");
        const plan = assemble("plan");
        const serviceOps = assemble("service-ops");

        expect(DEFAULT_AGENT_PROFILE).toBe("coding");
        const codingSystem = coding.messages[0]?.content ?? "";
        const planSystem = plan.messages[0]?.content ?? "";
        const serviceOpsSystem = serviceOps.messages[0]?.content ?? "";

        expect(coding.agentProfile).toBe("coding");
        expect(coding.tools.map((tool) => tool.name)).toEqual([
          "apply_patch",
          "list_files",
          "list_processes",
          "read_file",
          "read_process_output",
          "run_command",
          "run_shell",
          "search_code",
          "start_process",
          "stop_process",
          "write_file",
        ]);
        expect(codingSystem).not.toContain("update_plan");
        expect(codingSystem).not.toContain("Service lifecycle contract");
        expect(codingSystem).not.toContain("globally installed PM2");
        expect(coding.observations).toBeNull();

        expect(plan.tools.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "search_code",
          "update_plan",
        ]);
        expect(planSystem).toContain("update_plan");
        expect(planSystem).not.toContain("globally installed PM2");
        expect(plan.observations).toBeNull();

        expect(serviceOps.tools.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "refresh_observations",
          "search_code",
        ]);
        expect(serviceOpsSystem).toContain("globally installed PM2");
        expect(serviceOpsSystem).toContain("Service lifecycle contract");
        expect(serviceOps.observations).toContain("PM2 runtime and service/project associations");

        expect([...toolNamesForProfile("coding")]).toHaveLength(11);
        expect([...toolNamesForProfile("service-ops")]).toHaveLength(4);
        expect(TOOL_PACK_CATALOG.profiles.coding.packs).toEqual([
          "core.read",
          "core.write",
          "core.command",
          "process",
        ]);
        expect(TOOL_PACK_CATALOG.profiles["service-ops"].packs).toEqual([
          "core.read",
          "observation",
        ]);
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
