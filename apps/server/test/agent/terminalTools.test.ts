import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  type ProviderChunk,
  type ToolRegistry,
} from "@larness/agent";
import { expect, it } from "vitest";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { createTerminalTools } from "../../src/modules/agent/terminalTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import {
  type AuthorizedServer,
  startAuthorizedServer,
  stopAuthorizedServer,
} from "../support/server.js";

type TerminalRowView = {
  id: string;
  project_id: string | null;
  role: string | null;
  mode: string;
  status: string;
  created_by_turn_id: string | null;
};
type ApprovalRowView = {
  id: string;
  status: string;
  risk: string;
  tool_name: string;
  scope_json: string;
};

const FRONTEND =
  "process.stdout.write('FRONT_READY\\n' + 'x'.repeat(20000));setInterval(()=>{},1000)";
const BACKEND = "process.stdout.write('BACK_READY\\n');setInterval(()=>{},1000)";

async function until(check: () => boolean, label = "condition"): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function toolStep(id: string, name: string, args: unknown): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "tool-call", toolCall: { id, name, args } },
      { type: "finish", finishReason: "tool-calls" },
    ],
  };
}

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop" },
    ],
  };
}

function toolContents(f: Fixture): Record<string, unknown>[] {
  const messages = (f.lastProvider().calls.at(-1)?.messages ?? []) as {
    role?: string;
    content?: string;
  }[];
  return messages
    .filter((message) => message.role === "tool")
    .map((message) => JSON.parse(message.content ?? "{}") as Record<string, unknown>);
}

interface Fixture {
  started: AuthorizedServer;
  root: string;
  projectId: string;
  sessionId: string;
  clientId: string;
  events: { type: string; payload: unknown }[];
  newTurn: (text: string) => { turnId: string };
  runnerFor: (steps: { chunks: ProviderChunk[] }[]) => TurnRunner;
  lastProvider: () => ReturnType<typeof createFakeProvider>;
  approvals: (turnId: string) => ApprovalRowView[];
  pending: (turnId: string) => ApprovalRowView[];
  approve: (turnId: string) => Promise<void>;
  terminals: () => TerminalRowView[];
}

async function fixture(dir: string): Promise<Fixture> {
  const started = await startAuthorizedServer(path.join(dir, "data"));
  const root = path.join(dir, "project");
  await mkdir(root);
  const project = await createProject({ db: started.running.db }, { rootPath: root });
  const session = await createSession(
    { db: started.running.db, dataDir: started.running.dataDir },
    { projectId: project.id },
  );
  const client = (
    await started.running.app.inject({
      url: "/api/auth/session",
      headers: { cookie: started.cookie },
    })
  ).json() as { clientSessionId: string };
  const registry: ToolRegistry = createFileToolRegistry();
  for (const tool of createTerminalTools({ db: started.running.db })) registry.register(tool);
  const events: { type: string; payload: unknown }[] = [];
  let provider = createFakeProvider([]);
  const runnerFor = (steps: { chunks: ProviderChunk[] }[]) => {
    provider = createFakeProvider(steps);
    return new TurnRunner({
      db: started.running.db,
      registry,
      terminals: started.running.terminals,
      resolveProvider: () => ({ adapter: provider, model: "fake" }),
      publish: (event) => {
        if ("type" in event) events.push(event);
      },
      approvalPollMs: 5,
    });
  };
  const newTurn = (text: string) =>
    createTurn(
      { db: started.running.db },
      { sessionId: session.id, text, clientSessionId: client.clientSessionId },
    );
  const approvals = (turnId: string) =>
    started.running.sqlite
      .prepare(
        "SELECT id, status, risk, tool_name, scope_json FROM approvals WHERE turn_id = ? ORDER BY created_at, id",
      )
      .all(turnId) as ApprovalRowView[];
  const pending = (turnId: string) => approvals(turnId).filter((row) => row.status === "pending");
  const approve = async (turnId: string) => {
    await until(() => pending(turnId).length > 0, `pending approval for ${turnId}`);
    const row = pending(turnId)[0];
    if (!row) throw new Error("Missing pending approval");
    decideApproval(
      { db: started.running.db },
      { id: row.id, decision: "approve", decidedBy: "test-operator" },
    );
  };
  const terminals = () =>
    started.running.sqlite
      .prepare(
        "SELECT id, project_id, role, mode, status, created_by_turn_id FROM terminals ORDER BY role",
      )
      .all() as TerminalRowView[];

  return {
    started,
    root,
    projectId: project.id,
    sessionId: session.id,
    clientId: client.clientSessionId,
    events,
    newTurn,
    runnerFor,
    lastProvider: () => provider,
    approvals,
    pending,
    approve,
    terminals,
  };
}

it("starts two approved real project dev terminals, reports them to the model and does not hold the source lock", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const turn = f.newTurn("start dev servers");
      const runner = f.runnerFor([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "frontend",
                name: "start_project_terminal",
                args: { role: "frontend", executable: process.execPath, args: ["-e", FRONTEND] },
              },
            },
            {
              type: "tool-call",
              toolCall: {
                id: "backend",
                name: "start_project_terminal",
                args: { role: "backend", executable: process.execPath, args: ["-e", BACKEND] },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("开发终端已启动。"),
      ]);
      const running = runner.run(turn.turnId);
      await f.approve(turn.turnId);
      await f.approve(turn.turnId);
      expect((await running).status).toBe("COMPLETED");

      const rows = f.terminals();
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.role)).toEqual(["backend", "frontend"]);
      expect(rows.every((row) => row.mode === "dev" && row.status === "RUNNING")).toBe(true);
      expect(new Set(rows.map((row) => row.id)).size).toBe(2);

      const frontend = rows.find((row) => row.role === "frontend");
      expect(frontend).toBeDefined();
      const output = await f.started.running.terminals.output(frontend?.id ?? "", 0, 100);
      expect(output.chunks.map((chunk) => chunk.data).join("")).toContain("FRONT_READY");

      const approvals = f.approvals(turn.turnId);
      expect(approvals).toHaveLength(2);
      expect(approvals.every((row) => row.risk === "L2" && row.status === "approved")).toBe(true);
      expect(approvals[0]?.scope_json).toContain("process");
      expect(approvals[0]?.scope_json).toContain("frontend");

      const terminalEvent = f.events.find((event) => {
        if (event.type !== "tool.completed") return false;
        const payload = event.payload as { resourceTarget?: { kind?: string } };
        return payload.resourceTarget?.kind === "terminal";
      });
      if (!terminalEvent) throw new Error("Missing terminal tool.completed event");
      expect(
        (terminalEvent.payload as { originClientSessionId?: string }).originClientSessionId,
      ).toBe(f.clientId);

      const locks = f.started.running.sqlite
        .prepare("SELECT count(*) AS n FROM resource_locks WHERE expires_at > ?")
        .get(Date.now());
      expect(locks).toEqual({ n: 0 });

      const message = JSON.stringify(f.lastProvider().calls.at(-1)?.messages);
      expect(message).toContain("frontend");
      expect(message).toContain("RUNNING");
      expect(message).toContain(frontend?.id ?? "missing");
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("reuses an active role, rejects changed arguments, reads bounded output, stops explicitly and survives Turn cancellation", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const start = f.newTurn("start frontend and backend");
      const startRunner = f.runnerFor([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "frontend",
                name: "start_project_terminal",
                args: { role: "frontend", executable: process.execPath, args: ["-e", FRONTEND] },
              },
            },
            {
              type: "tool-call",
              toolCall: {
                id: "backend",
                name: "start_project_terminal",
                args: { role: "backend", executable: process.execPath, args: ["-e", BACKEND] },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("ok"),
      ]);
      const startRun = startRunner.run(start.turnId);
      await f.approve(start.turnId);
      await f.approve(start.turnId);
      expect((await startRun).status).toBe("COMPLETED");
      const frontend = f.terminals().find((row) => row.role === "frontend");
      const backend = f.terminals().find((row) => row.role === "backend");
      expect(frontend?.status).toBe("RUNNING");
      expect(backend?.status).toBe("RUNNING");

      const retry = f.newTurn("retry frontend");
      const retryRunner = f.runnerFor([
        toolStep("frontend-retry", "start_project_terminal", {
          role: "frontend",
          executable: process.execPath,
          args: ["-e", FRONTEND],
        }),
        textStep("reused"),
      ]);
      const retryRun = retryRunner.run(retry.turnId);
      await f.approve(retry.turnId);
      expect((await retryRun).status).toBe("COMPLETED");
      expect(f.terminals()).toHaveLength(2);
      expect(toolContents(f).at(-1)?.reused).toBe(true);

      const conflict = f.newTurn("conflict frontend");
      const conflictRunner = f.runnerFor([
        toolStep("frontend-conflict", "start_project_terminal", {
          role: "frontend",
          executable: process.execPath,
          args: ["-e", "console.log('different')"],
        }),
        textStep("conflict observed"),
      ]);
      const conflictRun = conflictRunner.run(conflict.turnId);
      await f.approve(conflict.turnId);
      expect((await conflictRun).status).toBe("COMPLETED");
      expect(f.terminals()).toHaveLength(2);
      expect(f.events.some((event) => event.type === "tool.failed")).toBe(true);
      expect(JSON.stringify(f.lastProvider().calls.at(-1)?.messages)).toContain("CONFLICT");

      const read = f.newTurn("read frontend output");
      const readRunner = f.runnerFor([
        toolStep("read-output", "read_terminal_output", { terminalId: frontend?.id, limit: 100 }),
        textStep("read done"),
      ]);
      expect((await readRunner.run(read.turnId)).status).toBe("COMPLETED");
      const readResult = toolContents(f).at(-1);
      expect(String(readResult?.output)).toContain("FRONT_READY");
      expect(readResult?.truncated).toBe(true);
      expect(JSON.stringify(readResult).length).toBeLessThan(20000);

      const stop = f.newTurn("stop backend");
      const stopRunner = f.runnerFor([
        toolStep("stop-backend", "stop_project_terminal", { terminalId: backend?.id }),
        textStep("stopped"),
      ]);
      expect((await stopRunner.run(stop.turnId)).status).toBe("COMPLETED");
      expect(f.terminals().find((row) => row.role === "backend")?.status).toBe("TERMINATED");
      expect(f.terminals().find((row) => row.role === "frontend")?.status).toBe("RUNNING");
      expect(toolContents(f).at(-1)?.status).toBe("TERMINATED");

      const cancel = f.newTurn("start another terminal");
      const cancelRunner = f.runnerFor([
        toolStep("worker-start", "start_project_terminal", {
          role: "worker",
          executable: process.execPath,
          args: ["-e", "setInterval(()=>{},1000)"],
        }),
        textStep("late"),
      ]);
      const cancelRun = cancelRunner.run(cancel.turnId);
      await until(() => f.pending(cancel.turnId).length > 0, "worker approval");
      cancelRunner.cancel(cancel.turnId);
      expect((await cancelRun).status).toBe("CANCELLED");
      expect(f.pending(cancel.turnId)).toHaveLength(0);
      expect(
        f
          .terminals()
          .filter((row) => row.status === "RUNNING")
          .map((row) => row.role),
      ).toEqual(["frontend"]);
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("rejects approval tampering, foreign and human terminals", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const args = {
        role: "frontend",
        executable: process.execPath,
        args: ["-e", "setInterval(()=>{},1000)"],
      };
      const tampered = f.newTurn("tampered start");
      const tamperedRunner = f.runnerFor([
        toolStep("tampered-start", "start_project_terminal", args),
        textStep("late"),
      ]);
      const tamperedRun = tamperedRunner.run(tampered.turnId);
      await until(() => f.pending(tampered.turnId).length > 0, "tampered approval");
      args.args = ["-e", "console.log('changed')"];
      const pending = f.pending(tampered.turnId)[0];
      if (!pending) throw new Error("Missing approval");
      decideApproval(
        { db: f.started.running.db },
        { id: pending.id, decision: "approve", decidedBy: "test-operator" },
      );
      expect((await tamperedRun).status).toBe("COMPLETED");
      expect(f.terminals()).toHaveLength(0);
      expect(toolContents(f).at(-1)?.errorCode).toBe("APPROVAL_INVALID");

      const started = f.newTurn("real start");
      const startedRunner = f.runnerFor([
        toolStep("real-start", "start_project_terminal", {
          role: "frontend",
          executable: process.execPath,
          args: ["-e", FRONTEND],
        }),
        textStep("started"),
      ]);
      const startedRun = startedRunner.run(started.turnId);
      await f.approve(started.turnId);
      expect((await startedRun).status).toBe("COMPLETED");
      const dev = f.terminals()[0];
      expect(dev?.status).toBe("RUNNING");

      const shell = await f.started.running.terminals.create(f.clientId, "human-shell", {
        scope: { projectId: f.projectId },
        riskAcknowledged: true,
      });
      expect((await f.started.running.terminals.read(shell.id)).status).toBe("RUNNING");

      const foreign = f.newTurn("foreign access");
      const foreignRunner = f.runnerFor([
        toolStep("foreign-read", "read_terminal_output", { terminalId: shell.id }),
        toolStep("foreign-stop", "stop_project_terminal", { terminalId: shell.id }),
        textStep("done"),
      ]);
      expect((await foreignRunner.run(foreign.turnId)).status).toBe("COMPLETED");
      expect((await f.started.running.terminals.read(shell.id)).status).toBe("RUNNING");
      expect(f.events.filter((event) => event.type === "tool.failed").length).toBeGreaterThan(0);

      const rootB = path.join(dir, "project-b");
      await mkdir(rootB);
      const projectB = await createProject({ db: f.started.running.db }, { rootPath: rootB });
      const sessionB = await createSession(
        { db: f.started.running.db, dataDir: f.started.running.dataDir },
        { projectId: projectB.id },
      );
      const turnB = createTurn(
        { db: f.started.running.db },
        { sessionId: sessionB.id, text: "cross project", clientSessionId: f.clientId },
      );
      const crossRunner = f.runnerFor([
        toolStep("cross-stop", "stop_project_terminal", { terminalId: dev?.id }),
        textStep("done"),
      ]);
      expect((await crossRunner.run(turnB.turnId)).status).toBe("COMPLETED");
      expect((await f.started.running.terminals.read(dev?.id ?? "")).status).toBe("RUNNING");
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
