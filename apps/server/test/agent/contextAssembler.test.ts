import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import { createProcessTools } from "../../src/modules/agent/processTool.js";
import { MemoryService } from "../../src/modules/memory/service.js";
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
  it("sends actionable tool guidance and the actual Turn policy for coding", async () => {
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
        for (const tool of [createCommandTool({}), createShellTool({}), ...createProcessTools({})])
          registry.register(tool);

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
                agentProfile: "coding",
              },
              sessionRow,
              turn,
            );
            expect(context.messages[0]?.content).toContain(`Turn approval policy: ${policy}`);
            expect(context.messages[0]?.content).toContain(`L2=${l2}`);
            expect(context.messages[0]?.content).not.toContain("update_plan");
            expect(context.messages[0]?.content).not.toContain("Service lifecycle contract");
            expect(context.messages[0]?.content).not.toContain("PM2 runtime");
            expect(context.messages[0]?.content).toContain(
              projectId ? "registered project workspace" : "workspace without a registered project",
            );
            const byName = new Map(context.tools.map((tool) => [tool.name, tool]));
            expect(byName.has("read_file")).toBe(true);
            expect(byName.has("run_command")).toBe(true);
            expect(byName.has("run_shell")).toBe(true);
            expect(byName.has("start_process")).toBe(Boolean(projectId));
            expect(byName.has("list_processes")).toBe(Boolean(projectId));
            expect(byName.has("git_status")).toBe(false);
            expect(byName.has("read_terminal_output")).toBe(false);
            expect(byName.has("start_project_terminal")).toBe(false);
            expect(byName.has("register_temporary_service")).toBe(false);
            expect(byName.has("start_service")).toBe(false);
            expect(byName.has("update_plan")).toBe(false);
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

  it("loads conversation history by token budget rather than a fixed 40 messages", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "seed" });

        for (let index = 0; index < 60; index += 1) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: first.turnId,
            type: index % 2 === 0 ? "user.message" : "assistant.message",
            payload: { turnId: first.turnId, text: `history-${index} ${"x".repeat(12)}` },
            now: 10 + index,
          });
        }

        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        const current = createTurn(sessionOptions, { sessionId: session.id, text: "current" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turnRow = getTurnById(opened.db, current.turnId);
        if (sessionRow === null || turnRow === null) throw new Error("fixture missing");

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

        const content = context.messages.map((message) => message.content).join("\n");
        expect(content).toContain("history-0");
        expect(content).toContain("history-59");
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

  it("injects global preferences and a bounded project index after instructions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const clock = { value: 1_000 };
        const sessionOptions = { db: opened.db, dataDir: dir, now: () => clock.value };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const first = createTurn(
          { db: opened.db, now: () => clock.value },
          {
            sessionId: session.id,
            text: "以后都用 pnpm",
          },
        );
        const user = appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: first.turnId,
          type: "user.message",
          payload: { text: "以后都用 pnpm" },
          now: clock.value,
        });
        const memory = new MemoryService({ db: opened.db, now: () => clock.value });
        memory.remember({
          scope: "global",
          kind: "preference",
          key: "workflow.package-manager",
          title: "Package manager",
          body: "以后都用 pnpm",
          evidence: {
            kind: "user_statement",
            turnId: first.turnId,
            eventSeq: user.seq,
            quote: "以后都用 pnpm",
          },
        });
        memory.remember({
          scope: "project",
          kind: "fact",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test",
          evidence: {
            kind: "user_statement",
            turnId: first.turnId,
            eventSeq: user.seq,
            quote: "以后都用 pnpm",
          },
        });

        const firstSession = getSessionById(opened.db, session.id);
        const firstTurn = getTurnById(opened.db, first.turnId);
        if (!firstSession || !firstTurn) throw new Error("fixture missing");

        const current = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            memory,
            now: () => clock.value,
          },
          firstSession,
          firstTurn,
        );
        expect(current.memoryInjected).toBe(0);

        clock.value = 2_000;
        const nextSession = await createSession(sessionOptions, { projectId: project.id });
        const second = createTurn(
          { db: opened.db, now: () => clock.value },
          {
            sessionId: nextSession.id,
            text: "run tests",
          },
        );
        const secondTurn = getTurnById(opened.db, second.turnId);
        if (!secondTurn) throw new Error("fixture missing");
        const secondSession = getSessionById(opened.db, nextSession.id);
        if (!secondSession) throw new Error("fixture missing");

        const next = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            memory,
            now: () => clock.value,
          },
          secondSession,
          secondTurn,
        );
        const system = String(next.messages[0]?.content);
        expect(next.memoryInjected).toBe(2);
        expect(system).toContain("User preferences");
        expect(system).toContain("workflow.package-manager");
        expect(system).toContain("Project memory index");
        expect(system).toContain("build.test.command");
        expect(system.indexOf("User preferences")).toBeLessThan(
          system.indexOf("Project memory index"),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("loads project instruction files before database instructions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(path.join(root, ".larness"), { recursive: true });
        await writeFile(path.join(root, "AGENTS.md"), "agents rules");
        await writeFile(path.join(root, ".larness", "instructions.md"), "larness rules");
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        updateProject(
          { db: opened.db },
          { id: project.id, settings: { instructions: "db rules" } },
        );

        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: project.id },
        );
        const created = createTurn({ db: opened.db }, { sessionId: session.id, text: "hi" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
            agentProfile: "coding",
          },
          sessionRow,
          turn,
        );
        const system = String(context.messages[0]?.content);
        const agentsAt = system.indexOf("agents rules");
        const larnessAt = system.indexOf("larness rules");
        const dbAt = system.indexOf("db rules");

        expect(agentsAt).toBeGreaterThan(-1);
        expect(larnessAt).toBeGreaterThan(agentsAt);
        expect(dbAt).toBeGreaterThan(larnessAt);
        expect(system).toContain("Project instructions from AGENTS.md");
        expect(system).toContain("Project instructions from .larness/instructions.md");
        expect(system).toContain("Project instructions from project settings");
      } finally {
        opened.close();
      }
    });
  });
});
