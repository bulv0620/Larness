import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { agentEvents } from "../../src/db/schema.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import {
  type AssembledContext,
  assembleContext,
} from "../../src/modules/agent/contextAssembler.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import { createProcessTools } from "../../src/modules/agent/processTool.js";
import { createWebTools } from "../../src/modules/agent/webTool.js";
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

function lastUserContent(context: AssembledContext): string {
  const last = context.messages.at(-1);
  return last?.role === "user" ? String(last.content) : "";
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
        const tail = lastUserContent(next);
        expect(next.memoryInjected).toBe(2);
        expect(tail).toContain("User preferences");
        expect(tail).toContain("workflow.package-manager");
        expect(tail).toContain("Project memory index");
        expect(tail).toContain("build.test.command");
        expect(tail.indexOf("User preferences")).toBeLessThan(tail.indexOf("Project memory index"));
        // The cached prefix must not carry per-Turn facts.
        expect(system).not.toContain("workflow.package-manager");
        expect(system).not.toContain("build.test.command");
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

  it("advertises web tools only when the Turn enables an available connection", async () => {
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
        const created = createTurn(sessionOptions, { sessionId: session.id, text: "web" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const registry = createFileToolRegistry();
        for (const tool of createWebTools()) registry.register(tool);

        const enabled = assembleContext(
          {
            db: opened.db,
            registry,
            maxContextTokens: 128_000,
            policy: "standard",
            agentProfile: "coding",
            webSearchAvailable: true,
            now: () => Date.parse("2026-11-20T00:00:00Z"),
          },
          sessionRow,
          turn,
        );
        expect(enabled.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["web_search", "fetch_url"]),
        );
        const system = String(enabled.messages[0]?.content);
        const tail = lastUserContent(enabled);
        expect(tail).toContain("Web search and page fetching are available");
        expect(tail).toContain("untrusted data");
        expect(tail).toContain("Current date: 2026-11-20");
        expect(system).not.toContain("Current date");
        expect(system).not.toContain("Web search and page fetching are available");

        const disabled = assembleContext(
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
        expect(disabled.tools.map((tool) => tool.name)).not.toContain("web_search");
        expect(disabled.tools.map((tool) => tool.name)).not.toContain("fetch_url");
        expect(lastUserContent(disabled)).not.toContain(
          "Web search and page fetching are available",
        );
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the system prefix byte-identical when a memory is written between turns", async () => {
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
        const turnOptions = { db: opened.db, now: () => clock.value };
        const session = await createSession(
          { db: opened.db, dataDir: dir, now: () => clock.value },
          { projectId: project.id },
        );
        const first = createTurn(turnOptions, { sessionId: session.id, text: "first task" });
        const userEvent = opened.db
          .select()
          .from(agentEvents)
          .where(and(eq(agentEvents.turnId, first.turnId), eq(agentEvents.type, "user.message")))
          .get();
        if (userEvent === undefined) throw new Error("user event missing");
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: first.turnId,
          type: "assistant.message",
          payload: { turnId: first.turnId, messageId: "msg_1", text: "first answer" },
          now: clock.value,
        });
        const memory = new MemoryService({ db: opened.db, now: () => clock.value });
        memory.remember({
          scope: "project",
          kind: "fact",
          key: "build.check.command",
          title: "Check command",
          body: "pnpm check",
          evidence: {
            kind: "user_statement",
            turnId: first.turnId,
            eventSeq: userEvent.seq,
            quote: "first task",
          },
        });

        const sessionRow = getSessionById(opened.db, session.id);
        const firstTurn = getTurnById(opened.db, first.turnId);
        if (!sessionRow || !firstTurn) throw new Error("fixture missing");
        const assemble = (turn: NonNullable<typeof firstTurn>) =>
          assembleContext(
            {
              db: opened.db,
              registry: createFileToolRegistry(),
              maxContextTokens: 128_000,
              policy: "standard",
              memory,
              now: () => clock.value,
            },
            sessionRow,
            turn,
          );

        const before = assemble(firstTurn);

        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        clock.value = 2_000;
        const second = createTurn(turnOptions, { sessionId: session.id, text: "second task" });
        const secondTurn = getTurnById(opened.db, second.turnId);
        if (!secondTurn) throw new Error("fixture missing");
        const after = assemble(secondTurn);

        // A1: the stable segment does not move when a memory is added.
        expect(after.messages[0]?.content).toBe(before.messages[0]?.content);
        expect(after.systemCore).toBe(before.systemCore);
        expect(after.instructions).toBe(before.instructions);
        expect(String(after.messages[0]?.content)).not.toContain("build.check.command");

        const tail = lastUserContent(after);
        expect(tail).toContain("build.check.command");
        expect(tail.startsWith("Context supplied by the system")).toBe(true);
        expect(after.messages.slice(1).map((message) => message.role)).toEqual([
          "user",
          "assistant",
          "user",
        ]);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the system stable when the date changes or web search is toggled", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: project.id },
        );
        const created = createTurn({ db: opened.db }, { sessionId: session.id, text: "news" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const registry = createFileToolRegistry();
        for (const tool of createWebTools()) registry.register(tool);

        const assemble = (webSearchAvailable: boolean, day: string) =>
          assembleContext(
            {
              db: opened.db,
              registry,
              maxContextTokens: 128_000,
              policy: "standard",
              agentProfile: "coding",
              webSearchAvailable,
              now: () => Date.parse(`${day}T00:00:00Z`),
            },
            sessionRow,
            turn,
          );

        const day1 = assemble(true, "2026-11-20");
        const day2 = assemble(true, "2026-11-21");
        expect(day2.messages[0]?.content).toBe(day1.messages[0]?.content);
        expect(lastUserContent(day1)).toContain("Current date: 2026-11-20");
        expect(lastUserContent(day2)).toContain("Current date: 2026-11-21");

        const off = assemble(false, "2026-11-21");
        expect(off.messages[0]?.content).toBe(day1.messages[0]?.content);
        expect(lastUserContent(off)).not.toContain("Web search and page fetching are available");
        expect(off.tools.map((tool) => tool.name)).not.toContain("web_search");

        // R-12: the switch owns the tool array; a dead connection only shows up
        // in the per-Turn policy block and in the executor's error.
        const degraded = assembleContext(
          {
            db: opened.db,
            registry,
            maxContextTokens: 128_000,
            policy: "standard",
            agentProfile: "coding",
            webToolsEnabled: true,
            webSearchAvailable: false,
          },
          sessionRow,
          turn,
        );
        expect(degraded.tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["web_search", "fetch_url"]),
        );
        expect(lastUserContent(degraded)).not.toContain(
          "Web search and page fetching are available",
        );
      } finally {
        opened.close();
      }
    });
  });

  it("trims to the low watermark so the history anchor stays put", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const seed = createTurn(sessionOptions, { sessionId: session.id, text: "seed" });
        for (let index = 0; index < 80; index += 1) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: seed.turnId,
            type: index % 2 === 0 ? "user.message" : "assistant.message",
            payload: { text: `history-${index} ${"x".repeat(400)}` },
            now: 10 + index,
          });
        }
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(seed.turnId);
        const created = createTurn(sessionOptions, { sessionId: session.id, text: "current" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const assemble = (maxContextTokens: number) =>
          assembleContext(
            {
              db: opened.db,
              registry: createFileToolRegistry(),
              maxContextTokens,
              policy: "standard",
            },
            sessionRow,
            turn,
          );

        const full = assemble(128_000);
        expect(full.truncatedHistory).toBe(false);

        // A window that makes this exact request exceed the 0.8 assembly budget.
        const window = Math.floor(full.estimatedTokens / 0.8) - 1;
        const trimmed = assemble(window);
        expect(trimmed.historyTrimmed).toBe(true);
        expect(trimmed.firstHistorySeq).toBeGreaterThan(full.firstHistorySeq ?? 0);
        expect(trimmed.estimatedTokens).toBeLessThanOrEqual(Math.floor(window * 0.65));

        // The next Turn neither crosses the budget nor moves the anchor: the
        // hysteresis is what keeps the cached prefix stable.
        for (const [index, type] of ["user.message", "assistant.message"].entries()) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: seed.turnId,
            type,
            payload: { text: `later-${index} ${"y".repeat(200)}` },
            now: 200 + index,
          });
        }
        const next = assemble(window);
        expect(next.firstHistorySeq).toBe(trimmed.firstHistorySeq);
        // The drop point is rounded to a block, so a couple of appended
        // messages do not shift the cached prefix.
        expect(next.messages.length).toBe(trimmed.messages.length + 2);
      } finally {
        opened.close();
      }
    });
  });

  it("flags the history scan cap instead of hiding the oldest events", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const seed = createTurn(sessionOptions, { sessionId: session.id, text: "seed" });
        for (let index = 0; index < 401; index += 1) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: seed.turnId,
            type: "user.message",
            payload: { text: `scan-${index}` },
            now: 10 + index,
          });
        }
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(seed.turnId);
        const created = createTurn(sessionOptions, { sessionId: session.id, text: "current" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, created.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          sessionRow,
          turn,
        );
        expect(context.historyScanTruncated).toBe(true);
        expect(context.truncatedHistory).toBe(true);
        expect(context.messages.at(-1)?.content).toContain(
          "Earlier conversation history was dropped",
        );
      } finally {
        opened.close();
      }
    });
  });

  it("replays recent read-only tool results across Turns with pairing intact", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "read a" });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: first.turnId,
          type: "assistant.message",
          payload: { text: "reading" },
          now: 2,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: first.turnId,
          type: "tool.replay",
          payload: {
            turnId: first.turnId,
            toolCallId: "call_1",
            toolName: "read_file",
            args: { path: "a.ts" },
            content: JSON.stringify({ path: "a.ts", version: "v1", content: "alpha" }),
          },
          now: 3,
        });
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        const second = createTurn(sessionOptions, { sessionId: session.id, text: "continue" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, second.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          sessionRow,
          turn,
        );
        const assistantIndex = context.messages.findIndex(
          (message) => message.role === "assistant" && message.toolCalls?.[0]?.id === "call_1",
        );
        const toolIndex = context.messages.findIndex(
          (message) => message.role === "tool" && message.toolCallId === "call_1",
        );

        expect(assistantIndex).toBeGreaterThan(0);
        expect(toolIndex).toBeGreaterThan(assistantIndex);
        expect(context.messages[toolIndex]).toMatchObject({
          role: "tool",
          toolName: "read_file",
        });
        expect(context.messages[toolIndex]?.content).toContain("alpha");
        expect(lastUserContent(context)).toContain("may be stale");
      } finally {
        opened.close();
      }
    });
  });

  it("folds older replay results before omitting them", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "read many" });

        for (let index = 0; index < 25; index += 1) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: first.turnId,
            type: "tool.replay",
            payload: {
              turnId: first.turnId,
              toolCallId: `call_${index}`,
              toolName: "read_file",
              args: { path: `f${index}.ts` },
              content: JSON.stringify({
                path: `f${index}.ts`,
                version: "v1",
                content: "x".repeat(6_000),
              }),
            },
            now: 10 + index,
          });
        }

        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        const second = createTurn(sessionOptions, { sessionId: session.id, text: "continue" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turn = getTurnById(opened.db, second.turnId);
        if (!sessionRow || !turn) throw new Error("fixture missing");

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          sessionRow,
          turn,
        );
        const toolContents = context.messages.flatMap((message) =>
          message.role === "tool" ? [message.content] : [],
        );

        expect(toolContents.length).toBeGreaterThan(0);
        expect(toolContents.some((content) => content.includes('"folded":true'))).toBe(true);
        expect(toolContents.at(-1)).toContain("x".repeat(100));
        expect(lastUserContent(context)).toContain("were pruned");
      } finally {
        opened.close();
      }
    });
  });
});
