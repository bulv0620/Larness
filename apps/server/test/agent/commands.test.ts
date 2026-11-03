import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry } from "@larness/agent";
import { expect, it } from "vitest";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { createCommandTool } from "../../src/modules/agent/commandTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function until(check: () => boolean) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Command integration timed out");
}
async function fixture(
  dir: string,
  code: string,
  timeoutMs = 2000,
  options: { lockTtlMs?: number; budget?: { maxDurationMs: number } } = {},
) {
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
  ).json();
  const turn = createTurn(
    { db: started.running.db },
    { sessionId: session.id, text: "run command", clientSessionId: client.clientSessionId },
  );
  const params = { executable: process.execPath, args: ["-e", code], timeoutMs };
  const provider = createFakeProvider([
    {
      chunks: [
        {
          type: "tool-call",
          toolCall: {
            id: "cmd_call",
            name: "run_command",
            args: params,
          },
        },
        { type: "finish", finishReason: "tool-calls" },
      ],
    },
    {
      chunks: [
        { type: "text-delta", text: "done" },
        { type: "finish", finishReason: "stop" },
      ],
    },
  ]);
  const registry = createFileToolRegistry();
  registry.register(createCommandTool({ db: started.running.db }));
  const events: { type: string; payload: unknown }[] = [];
  const runner = new TurnRunner({
    db: started.running.db,
    registry,
    commands: started.running.commands,
    resolveProvider: () => ({ adapter: provider, model: "fake" }),
    publish: (event) => {
      if ("type" in event) events.push(event);
    },
    approvalPollMs: 5,
    ...options,
  });
  const approvals = () =>
    started.running.sqlite
      .prepare("SELECT id, status FROM approvals WHERE turn_id = ?")
      .all(turn.turnId) as { id: string; status: string }[];
  return { started, root, turn, runner, provider, events, approvals, params };
}
it("requires approval for arbitrary scripts, runs a real command and returns bounded output to the provider", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(
      dir,
      "require('node:fs').writeFileSync('ran','yes');console.log('public output');process.exitCode=7",
    );
    try {
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
      decideApproval(
        { db: f.started.running.db },
        { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
      );
      expect((await running).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.root, "ran"), "utf8")).toBe("yes");
      const row = f.started.running.sqlite
        .prepare("SELECT status, exit_code FROM command_executions")
        .get();
      expect(row).toEqual({ status: "FAILED", exit_code: 7 });
      expect(f.events.some((e) => e.type === "tool.command.created")).toBe(true);
      const message = JSON.stringify(f.provider.calls.at(-1)?.messages);
      expect(message).toContain("public output");
      expect(message).toContain("exitCode");
      expect(message).toContain("cmd_");
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
it("cancels while awaiting approval without starting a process or a later provider step", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "require('node:fs').writeFileSync('forbidden','bad')");
    try {
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      f.runner.cancel(f.turn.turnId);
      expect((await running).status).toBe("CANCELLED");
      expect(f.approvals()[0].status).toBe("expired");
      expect(f.provider.calls).toHaveLength(1);
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it.each(["cancel", "timeout"])(
  "stops a real running command on %s and does not use a later step after Turn cancellation",
  async (mode) => {
    await withTempDir(async (dir) => {
      const f = await fixture(
        dir,
        "console.log('started');setInterval(()=>{},1000)",
        mode === "timeout" ? 250 : 5000,
      );
      try {
        const running = f.runner.run(f.turn.turnId);
        await until(() => f.approvals().length === 1);
        decideApproval(
          { db: f.started.running.db },
          { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
        );
        await until(
          () =>
            !!f.started.running.sqlite
              .prepare("SELECT id FROM command_executions WHERE status = 'RUNNING'")
              .get(),
        );
        if (mode === "cancel") f.runner.cancel(f.turn.turnId);
        expect((await running).status).toBe(mode === "cancel" ? "CANCELLED" : "COMPLETED");
        expect(
          f.started.running.sqlite.prepare("SELECT status FROM command_executions").get(),
        ).toEqual({ status: mode === "cancel" ? "CANCELLED" : "TIMED_OUT" });
        expect(f.provider.calls).toHaveLength(mode === "cancel" ? 1 : 2);
        expect(
          f.started.running.sqlite
            .prepare("SELECT count(*) AS n FROM resource_locks WHERE expires_at > ?")
            .get(Date.now()),
        ).toEqual({ n: 0 });
      } finally {
        await stopAuthorizedServer(f.started);
      }
    });
  },
);

it("rejects replacing approved command arguments", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "console.log('approved')");
    try {
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      f.params.args = ["-e", "require('node:fs').writeFileSync('forbidden','bad')"];
      decideApproval(
        { db: f.started.running.db },
        { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
      );
      await running;
      expect(
        f.events.some(
          (event) =>
            event.type === "tool.failed" &&
            JSON.stringify(event.payload).includes("APPROVAL_INVALID"),
        ),
      ).toBe(true);
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
it.each(["heartbeat", "budget"])(
  "passes inherited lock and remaining Turn %s to real command execution",
  async (mode) => {
    await withTempDir(async (dir) => {
      const f = await fixture(
        dir,
        mode === "heartbeat"
          ? "setTimeout(()=>console.log('done'),350)"
          : "setInterval(()=>{},1000)",
        5000,
        mode === "heartbeat" ? { lockTtlMs: 120 } : { budget: { maxDurationMs: 400 } },
      );
      try {
        const running = f.runner.run(f.turn.turnId);
        await until(() => f.approvals().length === 1);
        decideApproval(
          { db: f.started.running.db },
          { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
        );
        const result = await running;
        expect(result.status).toBe("COMPLETED");
        expect(
          f.started.running.sqlite.prepare("SELECT status FROM command_executions").get(),
        ).toEqual({ status: mode === "heartbeat" ? "COMPLETED" : "TIMED_OUT" });
        expect(f.provider.calls).toHaveLength(mode === "heartbeat" ? 2 : 1);
      } finally {
        await stopAuthorizedServer(f.started);
      }
    });
  },
);
it("classifies only exact development scripts as L1; arbitrary arguments and shells require L2, privileged programs L3", async () => {
  const { commandRisk } = await import("../../src/modules/agent/commandTool.js");
  const { decideToolAccess } = await import("@larness/agent");
  for (const executable of ["npm", "pnpm", "yarn"]) {
    expect(commandRisk({ executable, args: ["run", "test"] })).toBe("L1");
    expect(commandRisk({ executable, args: ["test", "--prefix", "/outside"] })).toBe("L2");
    expect(commandRisk({ executable: `/tmp/${executable}`, args: ["test"] })).toBe("L2");
  }
  expect(commandRisk({ executable: "/bin/sh", args: ["-c", "echo host"] })).toBe("L2");
  expect(commandRisk({ executable: "sudo", args: ["anything"] })).toBe("L3");
  expect(decideToolAccess("standard", "L3")).toBe("deny");
  expect(decideToolAccess("readonly", "L1")).toBe("deny");
  expect(decideToolAccess("strict", "L1")).toBe("require_approval");
});

it("executes an exact project test script under standard policy without creating an approval", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "unused");
    try {
      await writeFile(
        path.join(f.root, "package.json"),
        JSON.stringify({
          scripts: { test: `node -e "require('node:fs').writeFileSync('l1','yes')"` },
        }),
      );
      f.params.executable = "pnpm";
      f.params.args = ["test"];
      expect((await f.runner.run(f.turn.turnId)).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.root, "l1"), "utf8")).toBe("yes");
      expect(f.approvals()).toHaveLength(0);
      expect(
        f.started.running.sqlite.prepare("SELECT status FROM command_executions").get(),
      ).toEqual({ status: "COMPLETED" });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
it("expires approval at the Turn deadline without starting a command", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "console.log('must not run')", 5000, {
      budget: { maxDurationMs: 250 },
    });
    const running = f.runner.run(f.turn.turnId);
    try {
      await until(() => f.approvals().length === 1);
      expect((await running).status).toBe("COMPLETED");
      expect(f.approvals()[0].status).toBe("expired");
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
      expect(f.provider.calls).toHaveLength(1);
    } finally {
      f.runner.stop();
      await running;
      await stopAuthorizedServer(f.started);
    }
  });
});

it("keeps escaped output summaries within model budget as valid JSON and marks truncation", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "process.stdout.write(String.fromCharCode(1).repeat(100000))");
    try {
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      decideApproval(
        { db: f.started.running.db },
        { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
      );
      await running;
      const message = f.provider.calls.at(-1)?.messages.find((message) => message.role === "tool");
      expect(message?.content.length).toBeLessThan(20000);
      expect(JSON.parse(String(message?.content))).toMatchObject({ truncated: true });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
it("fails closed when recording the Turn-to-command link fails before spawn", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "require('node:fs').writeFileSync('forbidden','bad')");
    try {
      f.started.running.sqlite.exec(
        "CREATE TRIGGER fail_command_link BEFORE INSERT ON agent_events WHEN NEW.type = 'tool.command.created' BEGIN SELECT RAISE(ABORT, 'fixture'); END",
      );
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      decideApproval(
        { db: f.started.running.db },
        { id: f.approvals()[0].id, decision: "approve", decidedBy: "test-operator" },
      );
      await running;
      expect(
        f.started.running.sqlite.prepare("SELECT status, started_at FROM command_executions").get(),
      ).toEqual({ status: "FAILED", started_at: null });
      await expect(readFile(path.join(f.root, "forbidden"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("rechecks the actual originating client after approval and refuses revoked execution", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "console.log('must not run')");
    try {
      const running = f.runner.run(f.turn.turnId);
      await until(() => f.approvals().length === 1);
      f.started.running.sqlite
        .prepare("UPDATE browser_sessions SET revoked_at = ?")
        .run(Date.now());
      decideApproval(
        { db: f.started.running.db },
        { id: f.approvals()[0].id, decision: "approve", decidedBy: "other-operator" },
      );
      await running;
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
      expect(
        f.events.some(
          (event) =>
            event.type === "tool.failed" && JSON.stringify(event.payload).includes("FORBIDDEN"),
        ),
      ).toBe(true);
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
it("rejects known credential literals including quotes before creating approval summaries", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir, "unused");
    try {
      const secret = 'sk-m2-quoted-"credential';
      const response = await f.started.running.app.inject({
        method: "POST",
        url: "/api/credentials",
        headers: {
          cookie: f.started.cookie,
          origin: f.started.origin,
          "x-csrf-token": f.started.csrf,
        },
        payload: { provider: "deepseek", label: "fixture", apiKey: secret },
      });
      expect(response.statusCode).toBe(201);
      const tool = createCommandTool({
        db: f.started.running.db,
        secretStore: f.started.running.commands.options.secretStore,
      });
      expect(tool.schema.safeParse({ executable: process.execPath, args: [secret] }).success).toBe(
        false,
      );
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
