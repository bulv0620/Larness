import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import {
  activeMemoryByKey,
  allRevisionRows,
  memoryById,
} from "../../src/modules/memory/repository.js";
import { MemoryError, MemoryService } from "../../src/modules/memory/service.js";
import { createProject, deleteProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

async function fixture(dir: string, text = "Use pnpm test") {
  const opened = await openWorkspace(dir);
  const root = path.join(dir, "project");
  await mkdir(root);
  const project = await createProject(
    { db: opened.db, detectGit: async () => false },
    { rootPath: root },
  );
  const session = await createSession({ db: opened.db, dataDir: dir }, { projectId: project.id });
  const turn = createTurn({ db: opened.db }, { sessionId: session.id, text });
  const event = appendAgentEvent(opened.db, {
    sessionId: session.id,
    turnId: turn.turnId,
    type: "user.message",
    payload: { text },
    now: 1_000,
  });

  return { opened, project, session, turn, event, root };
}

function service(opened: OpenedDatabase, clock = { value: 1_000 }) {
  return new MemoryService({ db: opened.db, now: () => clock.value });
}

function appendCommandEvidence(f: Awaited<ReturnType<typeof fixture>>) {
  const toolCallId = "call_test";
  appendAgentEvent(f.opened.db, {
    sessionId: f.session.id,
    turnId: f.turn.turnId,
    type: "tool.requested",
    payload: { turnId: f.turn.turnId, toolCallId, name: "run_command", argsSummary: "pnpm test" },
    now: 1_001,
  });
  return appendAgentEvent(f.opened.db, {
    sessionId: f.session.id,
    turnId: f.turn.turnId,
    type: "tool.completed",
    payload: {
      turnId: f.turn.turnId,
      toolCallId,
      resultSummary: "Command COMPLETED; exit code 0",
    },
    now: 1_002,
  });
}

describe("memory service", () => {
  it("auto-activates a verified project fact and isolates it by project", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const commandEvent = appendCommandEvidence(f);
        const memory = service(f.opened).remember({
          scope: "project",
          kind: "command",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test",
          evidence: {
            kind: "command_succeeded",
            turnId: f.turn.turnId,
            eventSeq: commandEvent.seq,
          },
          confidence: 0.8,
        });

        expect(memory.status).toBe("active");
        expect(memory.projectId).toBe(f.project.id);
        expect(memory.verifiedAt).not.toBeNull();
        expect(
          activeMemoryByKey(f.opened.db, "project", f.project.id, "build.test.command")?.id,
        ).toBe(memory.id);
        expect(allRevisionRows(f.opened.db)).toHaveLength(1);

        const otherRoot = path.join(dir, "other");
        await mkdir(otherRoot);
        const other = await createProject(
          { db: f.opened.db, detectGit: async () => false },
          { rootPath: otherRoot },
        );
        expect(service(f.opened).listProject(other.id).items).toEqual([]);
      } finally {
        f.opened.close();
      }
    });
  });

  it("keeps decisions in review and requires a matching user quote for preferences", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir, "以后都用 pnpm");
      try {
        const svc = service(f.opened);
        const decision = svc.remember({
          scope: "project",
          kind: "decision",
          key: "build.tool.choice",
          title: "Use pnpm",
          body: "Use pnpm for this project",
          evidence: {
            kind: "user_statement",
            turnId: f.turn.turnId,
            eventSeq: f.event.seq,
            quote: "以后都用 pnpm",
          },
          confidence: 0.9,
        });
        expect(decision.status).toBe("review");

        const global = svc.remember({
          scope: "global",
          kind: "preference",
          key: "workflow.package-manager",
          title: "Package manager",
          body: "以后都用 pnpm",
          evidence: {
            kind: "user_statement",
            turnId: f.turn.turnId,
            eventSeq: f.event.seq,
            quote: "以后都用 pnpm",
          },
        });
        expect(global.status).toBe("active");
        expect(global.projectId).toBeNull();
        expect(svc.activeGlobalPreferences().map((row) => row.key)).toContain(
          "workflow.package-manager",
        );

        expect(() =>
          svc.remember({
            scope: "global",
            kind: "preference",
            key: "workflow.bad",
            title: "Bad",
            body: "use /Users/someone/project",
            evidence: {
              kind: "user_statement",
              turnId: f.turn.turnId,
              eventSeq: f.event.seq,
              quote: "以后都用 pnpm",
            },
          }),
        ).toThrow(MemoryError);
      } finally {
        f.opened.close();
      }
    });
  });

  it("supersedes an active key instead of creating two active rows", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir, "test with pnpm");
      try {
        const svc = service(f.opened);
        const command = appendCommandEvidence(f);
        const first = svc.remember({
          scope: "project",
          kind: "command",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test",
          evidence: {
            kind: "command_succeeded",
            turnId: f.turn.turnId,
            eventSeq: command.seq,
          },
        });
        const second = svc.remember({
          scope: "project",
          kind: "command",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test:unit",
          evidence: {
            kind: "command_succeeded",
            turnId: f.turn.turnId,
            eventSeq: command.seq,
          },
        });

        expect(second.id).not.toBe(first.id);
        expect(memoryById(f.opened.db, first.id)?.status).toBe("superseded");
        expect(memoryById(f.opened.db, second.id)?.status).toBe("active");
        expect(
          svc.listProject(f.project.id).items.filter((item) => item.status === "active"),
        ).toHaveLength(1);
      } finally {
        f.opened.close();
      }
    });
  });

  it("forgets with a suppression and does not relearn the same key", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const svc = service(f.opened);
        const command = appendCommandEvidence(f);
        const memory = svc.remember({
          scope: "project",
          kind: "command",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test",
          evidence: {
            kind: "command_succeeded",
            turnId: f.turn.turnId,
            eventSeq: command.seq,
          },
        });
        svc.forget(memory.id, "user");
        expect(memoryById(f.opened.db, memory.id)).toBeNull();

        expect(() =>
          svc.remember({
            scope: "project",
            kind: "command",
            key: "build.test.command",
            title: "Test command",
            body: "pnpm test",
            evidence: {
              kind: "command_succeeded",
              turnId: f.turn.turnId,
              eventSeq: command.seq,
            },
          }),
        ).toThrowError(/forgotten/);
      } finally {
        f.opened.close();
      }
    });
  });

  it("rejects the default workspace and disabled projects", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const svc = service(f.opened);
        expect(() => svc.listProject("prj_default")).toThrowError(/default workspace/);
      } finally {
        f.opened.close();
      }
    });
  });

  it("cascades memory rows when a project is deleted", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const command = appendCommandEvidence(f);
        service(f.opened).remember({
          scope: "project",
          kind: "command",
          key: "build.test.command",
          title: "Test command",
          body: "pnpm test",
          evidence: {
            kind: "command_succeeded",
            turnId: f.turn.turnId,
            eventSeq: command.seq,
          },
        });
        deleteProject({ db: f.opened.db }, { id: f.project.id });
        expect(service(f.opened).listGlobal().items).toEqual([]);
        expect(allRevisionRows(f.opened.db)).toEqual([]);
      } finally {
        f.opened.close();
      }
    });
  });
});
