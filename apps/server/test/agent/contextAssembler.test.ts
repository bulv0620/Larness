import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import { createServiceTools } from "../../src/modules/agent/serviceTool.js";
import { createProject, updateProject } from "../../src/modules/projects/service.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("context assembler", () => {
  it("sends actionable tool guidance and the actual Turn policy for each workspace", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const registry = createFileToolRegistry();
        const projectTools = createServiceTools();
        for (const tool of projectTools) registry.register(tool);

        for (const projectId of [project.id, undefined]) {
          const session = await createSession(sessionOptions, { projectId });
          const created = createTurn(sessionOptions, { sessionId: session.id, text: "start dev" });
          const sessionRow = getSessionById(opened.db, session.id);
          const turn = getTurnById(opened.db, created.turnId);
          if (!sessionRow || !turn) throw new Error("fixture missing");
          for (const [policy, l2] of [
            ["standard", "require_approval"],
            ["strict", "require_approval"],
            ["readonly", "deny"],
            ["autonomous", "allow"],
          ] as const) {
            const context = assembleContext(
              {
                db: opened.db,
                registry,
                maxContextTokens: 128_000,
                policy,
                agentProfile: "service-ops",
              },
              sessionRow,
              turn,
            );
            expect(context.messages[0]?.content).toContain(`Turn approval policy: ${policy}`);
            expect(context.messages[0]?.content).toContain(`L2=${l2}`);
            expect(context.messages[0]?.content).not.toContain("update_plan");
            expect(context.messages[0]?.content).toContain("Service lifecycle contract");
            expect(context.messages[0]?.content).toContain("development_preview");
            expect(context.messages[0]?.content).toContain("persistent_pm2");
            expect(context.messages[0]?.content).not.toContain("PM2 runtime");
            expect(context.messages[0]?.content).not.toContain("Registered status");
            expect(context.messages[0]?.content).toContain(
              projectId ? "registered project workspace" : "workspace without a registered project",
            );
            const byName = new Map(context.tools.map((tool) => [tool.name, tool]));
            expect(byName.has("read_file")).toBe(true);
            expect(byName.has("git_status")).toBe(false);
            expect(byName.has("git_commit")).toBe(false);
            expect(byName.has("read_terminal_output")).toBe(false);
            expect(byName.has("send_terminal_input")).toBe(false);
            expect(byName.has("start_project_terminal")).toBe(false);
            expect(byName.has("stop_project_terminal")).toBe(false);
            for (const name of projectTools.map((tool) => tool.name))
              expect(byName.has(name)).toBe(Boolean(projectId));
            if (projectId) {
              const register = byName.get("register_temporary_service");
              expect(register?.description).toContain("not PM2");
              expect(register?.description).toMatch(/wildcard.*0\.0\.0\.0.*without.*restart/i);
              expect(register?.parameters).toMatchObject({
                properties: {
                  kind: {
                    const: "temporary",
                    description: expect.stringContaining("not create a persistent PM2 service"),
                  },
                  terminalId: { description: expect.stringContaining("not a PM2 targetId") },
                  endpoint: {
                    description: expect.stringMatching(/actual bind address/i),
                    properties: { host: { enum: ["127.0.0.1", "::1"] } },
                  },
                },
              });
            }
          }
        }
      } finally {
        opened.close();
      }
    });
  });

  it("does not inject Git availability or Git tools after the model surface moved to shell", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "check git" });
        const turnRow = getTurnById(opened.db, turn.turnId);
        if (turnRow === null) throw new Error("turn missing");

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          session,
          turnRow,
        );
        expect(context.messages[0]?.content).not.toContain("Git availability");
        expect(context.messages[0]?.content).not.toContain("GIT_UNAVAILABLE");
        expect(context.tools.map((tool) => tool.name)).not.toContain("git_status");
      } finally {
        opened.close();
      }
    });
  });

  it("orders safety, project instructions, history and the current request", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false, now: () => 1 },
          { rootPath: root },
        );
        updateProject(
          { db: opened.db, now: () => 2 },
          { id: project.id, settings: { instructions: "Always use tabs." } },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "first task" });
        immediateTransaction(opened.db, (tx) => {
          appendAgentEvent(tx, {
            sessionId: session.id,
            turnId: first.turnId,
            type: "assistant.message",
            payload: {
              turnId: first.turnId,
              messageId: "msg_1",
              text: `first answer ${"x".repeat(8_000)}`,
            },
            now: 11,
          });
        });
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        const second = createTurn(sessionOptions, { sessionId: session.id, text: "second task" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turnRow = getTurnById(opened.db, second.turnId);

        if (sessionRow === null || turnRow === null) {
          throw new Error("fixture missing");
        }

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          sessionRow,
          turnRow,
        );

        expect(context.messages[0]).toMatchObject({ role: "system" });
        expect(String(context.messages[0]?.content)).toContain("Always use tabs.");
        expect(context.messages.map((message) => message.role)).toEqual([
          "system",
          "user",
          "assistant",
          "user",
        ]);
        expect(context.tools.map((tool) => tool.name)).toContain("apply_patch");
        expect(context.truncatedHistory).toBe(false);

        const narrow = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 100,
            policy: "standard",
          },
          sessionRow,
          turnRow,
        );
        expect(narrow.truncatedHistory).toBe(true);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the cacheable prefix byte-stable while Turn-start observations change", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const created = createTurn(sessionOptions, { sessionId: session.id, text: "observe" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const pm2 = (version: string) => ({
          available: true,
          nodeExecutable: "/usr/bin/node",
          entry: "/usr/lib/pm2/bin/pm2",
          version,
          home: path.join(dir, "pm2"),
          namespace: "larness" as const,
          serviceNamePattern: "larness:<projectId>:<serviceKey>" as const,
          project: null,
          services: [],
        });
        const base = {
          db: opened.db,
          registry: createFileToolRegistry(),
          maxContextTokens: 128_000,
          policy: "standard" as const,
          agentProfile: "service-ops" as const,
        };
        const first = assembleContext({ ...base, pm2Context: pm2("7.1.2") }, sessionRow, turn);
        const second = assembleContext({ ...base, pm2Context: pm2("7.2.0") }, sessionRow, turn);

        // A prefix cache matches from the start of the request, so a changed
        // observation may only touch the trailing block.
        expect(second.messages[0]).toEqual(first.messages[0]);
        expect(first.messages.at(-1)).not.toEqual(second.messages.at(-1));
        expect(first.observations).toContain("PM2 runtime and service/project associations");
        expect(first.messages.at(-1)?.content).toBe(first.observations);
      } finally {
        opened.close();
      }
    });
  });
});
