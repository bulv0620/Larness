import { randomUUID } from "node:crypto";
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
import { createTerminalControlTools } from "../../src/modules/agent/terminalControlTool.js";
import { createTerminalTools } from "../../src/modules/agent/terminalTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { type AuthorizedServer, startAuthorizedServer } from "../support/server.js";

const SCRIPT =
  "process.stdin.on('data',d=>process.stdout.write('GOT:'+d.toString()));process.on('SIGINT',()=>process.stdout.write('INT\\n'));setInterval(()=>{},1000)";

type ApprovalRow = { id: string; status: string; tool_name: string; scope_json: string };

async function until(check: () => boolean | Promise<boolean>, label = "condition"): Promise<void> {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

type Step = { chunks: ProviderChunk[]; delayMs?: number };

function toolStep(id: string, name: string, args: unknown): Step {
  return {
    chunks: [
      { type: "tool-call", toolCall: { id, name, args } },
      { type: "finish", finishReason: "tool-calls" },
    ],
  };
}

function textStep(text: string): Step {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop" },
    ],
  };
}

interface Fixture {
  started: AuthorizedServer;
  projectId: string;
  sessionId: string;
  clientId: string;
  turnId: string;
  registry: ToolRegistry;
  events: { type: string; payload: unknown }[];
  approvals: () => ApprovalRow[];
  approve: () => Promise<void>;
  runnerFor: (steps: Step[]) => TurnRunner;
  newTurn: () => { turnId: string };
  provider: () => ReturnType<typeof createFakeProvider>;
  output: (terminalId: string) => Promise<string>;
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
  const turn = createTurn(
    { db: started.running.db },
    { sessionId: session.id, text: "terminal control", clientSessionId: client.clientSessionId },
  );
  updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
  const registry = createFileToolRegistry();
  for (const tool of createTerminalTools({ db: started.running.db })) registry.register(tool);
  for (const tool of createTerminalControlTools({ db: started.running.db }))
    registry.register(tool);
  const events: { type: string; payload: unknown }[] = [];
  let provider = createFakeProvider([]);
  const runnerFor = (steps: Step[]) => {
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
  const approvals = () =>
    started.running.sqlite
      .prepare("SELECT id, status, tool_name, scope_json FROM approvals ORDER BY created_at, id")
      .all() as ApprovalRow[];
  const approve = async () => {
    await until(() => approvals().some((row) => row.status === "pending"), "pending approval");
    const row = approvals().find((item) => item.status === "pending");
    if (!row) throw new Error("Missing approval");
    decideApproval(
      { db: started.running.db },
      { id: row.id, decision: "approve", decidedBy: "test-operator" },
    );
  };
  const newTurn = () =>
    createTurn(
      { db: started.running.db },
      { sessionId: session.id, text: "more control", clientSessionId: client.clientSessionId },
    );
  const output = async (terminalId: string) => {
    const chunks = await started.running.terminals.output(terminalId, 0, 500);
    return chunks.chunks.map((chunk) => chunk.data).join("");
  };
  return {
    started,
    projectId: project.id,
    sessionId: session.id,
    clientId: client.clientSessionId,
    turnId: turn.turnId,
    registry,
    events,
    approvals,
    approve,
    runnerFor,
    newTurn,
    provider: () => provider,
    output,
  };
}

it("acquires AI control, sequences input, interrupts, and permits atomic human takeover", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    const manager = f.started.running.terminals;
    const context = {
      clientSessionId: f.clientId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      turnId: f.turnId,
      toolCallId: "control",
    };
    const terminal = await manager.createDev(
      { ...context, policySnapshotId: "fixture", assertAuthorized: () => {} },
      { role: "io", executable: process.execPath, args: ["-e", SCRIPT], cwd: "." },
    );
    try {
      const acquired = await manager.acquireAgent(terminal.id, context);
      expect(acquired.lease).toMatchObject({ ownerType: "agent", generation: 1 });
      expect((await manager.inputAgent(terminal.id, context, 1, 1, "hello\n")).accepted).toBe(true);
      await until(() => f.output(terminal.id).then((text) => text.includes("GOT:hello")));
      expect((await manager.inputAgent(terminal.id, context, 1, 1, "replay")).accepted).toBe(false);
      await expect(manager.inputAgent(terminal.id, context, 1, 3, "gap\n")).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
      expect((await manager.inputAgent(terminal.id, context, 1, 2, "again\n")).accepted).toBe(true);
      expect((await manager.interruptAgent(terminal.id, context, 1)).sent).toBe(true);
      await until(() => f.output(terminal.id).then((text) => text.includes("INT")));
      expect((await manager.read(terminal.id)).status).toBe("RUNNING");

      const connectionId = randomUUID();
      manager.connect(f.clientId, connectionId, () => true);
      manager.subscribe(terminal.id, connectionId);
      const taken = await manager.takeover(terminal.id, f.clientId, connectionId);
      expect(taken.lease).toMatchObject({ ownerType: "human", generation: 2 });
      await expect(manager.inputAgent(terminal.id, context, 1, 3, "old\n")).rejects.toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      await expect(manager.acquireAgent(terminal.id, context)).rejects.toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      await manager.input(terminal.id, f.clientId, connectionId, 2, 1, "human\n");
      await until(() => f.output(terminal.id).then((text) => text.includes("GOT:human")));
      await manager.lease(terminal.id, f.clientId, {
        action: "release",
        connectionId,
        leaseGeneration: 2,
      });
      const regained = await manager.acquireAgent(terminal.id, context);
      expect(regained.lease).toMatchObject({ ownerType: "agent", generation: 3 });

      const loggedOut = await f.started.running.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie: f.started.cookie,
          origin: f.started.origin,
          "x-csrf-token": f.started.csrf,
        },
        payload: {},
      });
      expect(loggedOut.statusCode).toBe(204);
      manager.expireLeases();
      expect((await manager.read(terminal.id)).lease).toBeNull();
      expect((await manager.read(terminal.id)).status).toBe("RUNNING");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("wires acquire, input, interrupt and read through approvals without persisting typed input", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const startRunner = f.runnerFor([
        toolStep("start", "start_project_terminal", {
          role: "io",
          executable: process.execPath,
          args: ["-e", SCRIPT],
        }),
        textStep("started"),
      ]);
      const startRun = startRunner.run(f.turnId);
      await f.approve();
      expect((await startRun).status).toBe("COMPLETED");
      const terminal = f.started.running.sqlite
        .prepare("SELECT id FROM terminals WHERE role = 'io'")
        .get() as { id: string };
      expect(terminal.id).toMatch(/^term_/);

      const turn = f.newTurn();
      const controlRunner = f.runnerFor([
        toolStep("acquire", "acquire_terminal_control", { terminalId: terminal.id }),
        toolStep("send", "send_terminal_input", {
          terminalId: terminal.id,
          leaseGeneration: 1,
          inputSequence: 1,
          data: "secret-payload\n",
        }),
        toolStep("read", "read_terminal_output", { terminalId: terminal.id }),
        toolStep("interrupt", "interrupt_terminal", {
          terminalId: terminal.id,
          leaseGeneration: 1,
        }),
        textStep("done"),
      ]);
      const run = controlRunner.run(turn.turnId);
      await f.approve();
      await f.approve();
      expect((await run).status).toBe("COMPLETED");

      const row = await f.started.running.terminals.read(terminal.id);
      expect(row.status).toBe("RUNNING");
      expect(row.lease).toBeNull();
      await until(async () => (await f.output(terminal.id)).includes("GOT:secret-payload"));
      await until(async () => (await f.output(terminal.id)).includes("INT"));
      const text = await f.output(terminal.id);
      expect(text).toContain("GOT:secret-payload");
      expect(text).toContain("INT");

      const persisted = JSON.stringify({
        audits: f.started.running.sqlite.prepare("SELECT details_json FROM audit_logs").all(),
        events: f.started.running.sqlite.prepare("SELECT payload_json FROM agent_events").all(),
        approvals: f.started.running.sqlite.prepare("SELECT scope_json FROM approvals").all(),
      });
      expect(persisted).not.toContain("secret-payload");
      expect(f.approvals().some((approval) => approval.tool_name === "send_terminal_input")).toBe(
        true,
      );
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("releases the agent lease when the Turn is cancelled but keeps the terminal running", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const startRunner = f.runnerFor([
        toolStep("start", "start_project_terminal", {
          role: "io",
          executable: process.execPath,
          args: ["-e", SCRIPT],
        }),
        textStep("started"),
      ]);
      const startRun = startRunner.run(f.turnId);
      await f.approve();
      expect((await startRun).status).toBe("COMPLETED");
      const terminal = f.started.running.sqlite
        .prepare("SELECT id FROM terminals WHERE role = 'io'")
        .get() as { id: string };

      const turn = f.newTurn();
      const runner = f.runnerFor([
        toolStep("acquire", "acquire_terminal_control", { terminalId: terminal.id }),
        { delayMs: 8_000, chunks: [{ type: "text-delta", text: "late" }] },
      ]);
      const run = runner.run(turn.turnId);
      await until(() => {
        const lease = f.started.running.sqlite
          .prepare("SELECT owner_type FROM terminal_leases WHERE terminal_id = ?")
          .get(terminal.id) as { owner_type: string | null } | undefined;
        return lease?.owner_type === "agent";
      }, "agent lease");
      runner.cancel(turn.turnId);
      expect((await run).status).toBe("CANCELLED");
      expect((await f.started.running.terminals.read(terminal.id)).lease).toBeNull();
      expect((await f.started.running.terminals.read(terminal.id)).status).toBe("RUNNING");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
}, 15_000);

it("controls a human-created project shell while refusing another project and a held human lease", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    const manager = f.started.running.terminals;
    const context = {
      clientSessionId: f.clientId,
      projectId: f.projectId,
      sessionId: f.sessionId,
      turnId: f.turnId,
      toolCallId: "shell-control",
    };
    try {
      const terminal = await manager.create(f.clientId, "human-shell", {
        scope: { projectId: f.projectId },
        riskAcknowledged: true,
      });
      await expect(
        manager.acquireAgent(terminal.id, { ...context, projectId: "another-project" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const acquired = await manager.acquireAgent(terminal.id, context);
      const generation = acquired.lease?.generation ?? 0;
      expect(generation).toBeGreaterThan(0);
      await manager.inputAgent(
        terminal.id,
        context,
        generation,
        1,
        process.platform === "win32"
          ? "echo SHELL_CONTROL_ok\r"
          : "printf 'SHELL_CONTROL_%s\\n' ok\r",
      );
      await until(() => f.output(terminal.id).then((text) => text.includes("SHELL_CONTROL_ok")));
      expect(
        (await manager.readProjectTerminalOutput(terminal.id, f.projectId, 0, 100)).chunks.length,
      ).toBeGreaterThan(0);
      const cid = randomUUID();
      manager.connect(f.clientId, cid, () => true);
      manager.subscribe(terminal.id, cid);
      await manager.takeover(terminal.id, f.clientId, cid);
      await expect(manager.acquireAgent(terminal.id, context)).rejects.toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      await expect(
        manager.inputAgent(terminal.id, context, generation, 2, "old\r"),
      ).rejects.toMatchObject({ code: "TERMINAL_LEASE_REQUIRED" });
      await expect(
        manager.stopProjectDev(terminal.id, f.projectId, f.clientId),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("uses the approved Agent tools to type and read a manually created Shell", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const terminal = await f.started.running.terminals.create(f.clientId, "tool-shell", {
        scope: { projectId: f.projectId },
        riskAcknowledged: true,
      });
      const runner = f.runnerFor([
        toolStep("acquire-shell", "acquire_terminal_control", { terminalId: terminal.id }),
        toolStep("send-shell", "send_terminal_input", {
          terminalId: terminal.id,
          leaseGeneration: 1,
          inputSequence: 1,
          data:
            process.platform === "win32"
              ? "echo AGENT_SHELL_ok\r"
              : "printf 'AGENT_SHELL_%s\\n' ok\r",
        }),
        toolStep("read-shell", "read_terminal_output", { terminalId: terminal.id }),
        textStep("shell done"),
      ]);
      const run = runner.run(f.turnId);
      await f.approve();
      expect((await run).status).toBe("COMPLETED");
      await until(() => f.output(terminal.id).then((text) => text.includes("AGENT_SHELL_ok")));
      expect((await f.started.running.terminals.read(terminal.id)).lease).toBeNull();
      expect(f.events.filter((event) => event.type === "tool.failed")).toHaveLength(0);
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});
