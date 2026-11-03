import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

it("persists a real command before execution, serves authorized output and reuses the same operation", async () => {
  await withTempDir(async (dir) => {
    const started = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const root = path.join(dir, "project");
      await mkdir(root);
      const project = await createProject({ db: started.running.db }, { rootPath: root });
      const session = await createSession(
        { db: started.running.db, dataDir: started.running.dataDir },
        { projectId: project.id },
      );
      const turn = createTurn(
        { db: started.running.db },
        { sessionId: session.id, text: "command" },
      );
      updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
      const auth = (
        await started.running.app.inject({
          url: "/api/auth/session",
          headers: { cookie: started.cookie },
        })
      ).json();
      const context = {
        sessionId: session.id,
        turnId: turn.turnId,
        toolCallId: "call_test",
        policySnapshotId: "policy_test",
        clientSessionId: auth.clientSessionId,
        remainingMs: 5000,
        assertAuthorized: () => {},
      };
      const params = {
        executable: process.execPath,
        args: [
          "-e",
          "require('node:fs').appendFileSync('ran','once');console.log('hello');process.exitCode=3",
        ],
      };
      const result = await started.running.commands.execute(context, params);
      expect(result).toMatchObject({ status: "FAILED", exitCode: 3, reasonCode: "NONZERO_EXIT" });
      expect(await started.running.commands.execute(context, params)).toMatchObject({
        id: result.id,
      });
      expect(await readFile(path.join(root, "ran"), "utf8")).toBe("once");
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      expect(
        (await started.running.app.inject({ url: `/api/commands/${result.id}` })).statusCode,
      ).toBe(401);
      const output = await started.running.app.inject({
        url: `/api/commands/${result.id}/output`,
        headers,
      });
      expect(output.statusCode).toBe(200);
      expect(
        output
          .json()
          .chunks.map((chunk: { data: string }) => chunk.data)
          .join(""),
      ).toContain("hello");
      expect(
        (
          await started.running.app.inject({
            url: `/api/commands/${result.id}/output?after=999`,
            headers,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await started.running.app.inject({
            method: "POST",
            url: "/api/commands",
            headers,
            payload: params,
          })
        ).statusCode,
      ).toBe(404);
      const events = started.running.sqlite
        .prepare("SELECT * FROM resource_events WHERE stream_id = ? ORDER BY seq")
        .all(result.id) as { seq: number; payload_json: string }[];
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(JSON.stringify(events)).not.toContain("appendFileSync");
      updateTurnRow(started.running.db, context.turnId, {
        status: "COMPLETED",
        endedAt: Date.now(),
      });
      const nextTurn = createTurn(
        { db: started.running.db },
        { sessionId: session.id, text: "next command" },
      );
      updateTurnRow(started.running.db, nextTurn.turnId, { status: "RUNNING" });
      const next = await started.running.commands.execute(
        { ...context, turnId: nextTurn.turnId },
        params,
      );
      expect(next.id).not.toBe(result.id);
      expect(await readFile(path.join(root, "ran"), "utf8")).toBe("onceonce");
    } finally {
      await stopAuthorizedServer(started);
    }
  });
});

async function commandFixture(dir: string) {
  const started = await startAuthorizedServer(path.join(dir, "data"));
  const root = path.join(dir, "project");
  await mkdir(root);
  const project = await createProject({ db: started.running.db }, { rootPath: root });
  const session = await createSession(
    { db: started.running.db, dataDir: started.running.dataDir },
    { projectId: project.id },
  );
  const turn = createTurn(
    { db: started.running.db },
    { sessionId: session.id, text: "command fixture" },
  );
  updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
  const auth = (
    await started.running.app.inject({
      url: "/api/auth/session",
      headers: { cookie: started.cookie },
    })
  ).json();
  const context = {
    sessionId: session.id,
    turnId: turn.turnId,
    toolCallId: "call_fixture",
    policySnapshotId: "policy_fixture",
    clientSessionId: auth.clientSessionId as string,
    remainingMs: 5000,
    assertAuthorized: () => {},
  };
  return {
    started,
    root,
    project,
    context,
    headers: { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf },
  };
}
async function waitForCommand(test: () => boolean | Promise<boolean>) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Command fixture timed out");
}

it("cancels once through authenticated REST, cleans a real process tree, and holds the root until stopped", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    let promise: Promise<unknown> | undefined;
    try {
      const marker = path.join(f.root, "pids.json");
      let id = "";
      promise = f.started.running.commands.execute(
        {
          ...f.context,
          onCreated: (created) => {
            id = created;
          },
        },
        {
          executable: process.execPath,
          args: [
            "-e",
            "const {spawn}=require('node:child_process');const fs=require('node:fs');const marker=process.argv[1];const c=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],'ready');setInterval(()=>{},1000)\",marker+'.child'],{stdio:'ignore'});const ready=setInterval(()=>{if(fs.existsSync(marker+'.child')){clearInterval(ready);fs.writeFileSync(marker,JSON.stringify({parent:process.pid,child:c.pid}));}},10);setInterval(()=>{},1000)",
            marker,
          ],
        },
      );
      await waitForCommand(async () => {
        try {
          await readFile(marker);
          return true;
        } catch {
          return false;
        }
      });
      const pids = JSON.parse(await readFile(marker, "utf8")) as { parent: number; child: number };
      await writeFile(path.join(f.root, "shared.txt"), "original");
      const opened = (
        await f.started.running.app.inject({
          url: `/api/files?projectId=${f.project.id}&path=shared.txt`,
          headers: f.headers,
        })
      ).json();
      const blockedSave = await f.started.running.app.inject({
        method: "PUT",
        url: "/api/files",
        headers: f.headers,
        payload: {
          scope: { projectId: f.project.id },
          path: "shared.txt",
          content: "unsafe",
          expectedVersion: opened.version,
        },
      });
      expect(blockedSave.statusCode).toBe(409);
      expect(blockedSave.json().error.code).toBe("RESOURCE_LOCKED");
      expect(await readFile(path.join(f.root, "shared.txt"), "utf8")).toBe("original");
      const competing = { ...f.context, toolCallId: "different_tool" };
      await expect(
        f.started.running.commands.execute(competing, {
          executable: process.execPath,
          args: ["-e", ""],
        }),
      ).rejects.toMatchObject({ code: "RESOURCE_LOCKED" });
      expect(
        (
          await f.started.running.app.inject({
            method: "POST",
            url: `/api/commands/${id}/cancel`,
            headers: { cookie: f.started.cookie, origin: f.started.origin },
            payload: {},
          })
        ).statusCode,
      ).toBe(403);
      const responses = await Promise.all(
        [1, 2].map(() =>
          f.started.running.app.inject({
            method: "POST",
            url: `/api/commands/${id}/cancel`,
            headers: f.headers,
            payload: {},
          }),
        ),
      );
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(responses[0]?.json()).toMatchObject({ status: "CANCELLED" });
      await promise;
      const { alive } = await import("../../scripts/m2-poc/system.js");
      expect(await alive(pids.parent)).toBe(false);
      expect(await alive(pids.child)).toBe(false);
      expect(
        f.started.running.sqlite
          .prepare(
            "SELECT count(*) AS n FROM resource_events WHERE stream_id = ? AND payload_json LIKE '%CANCELLING%'",
          )
          .get(id),
      ).toEqual({ n: 1 });
      const fresh = await f.started.running.commands.execute(competing, {
        executable: process.execPath,
        args: ["-e", ""],
      });
      expect(fresh.status).toBe("COMPLETED");
    } finally {
      await stopAuthorizedServer(f.started);
      await promise?.catch(() => {});
    }
  });
});

it("fails closed before spawning when intent or audit persistence fails", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    try {
      f.started.running.sqlite.exec(
        "CREATE TRIGGER fail_command_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'command.created' BEGIN SELECT RAISE(FAIL, 'fixture-audit-unavailable'); END",
      );
      await expect(
        f.started.running.commands.execute(f.context, {
          executable: process.execPath,
          args: ["-e", "require('node:fs').writeFileSync('unsafe','ran')"],
        }),
      ).rejects.toBeDefined();
      await expect(readFile(path.join(f.root, "unsafe"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        f.started.running.sqlite.prepare("SELECT count(*) AS n FROM command_executions").get(),
      ).toEqual({ n: 0 });
      expect(
        f.started.running.sqlite
          .prepare("SELECT count(*) AS n FROM resource_operations WHERE kind = 'command.run'")
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("redacts known secrets and sensitive fields before disk, and enforces output expiry without resetting cursors", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    try {
      const secret = "sk-command-test-only-secret";
      await writeFile(path.join(f.root, "secret.txt"), secret);
      expect(
        (
          await f.started.running.app.inject({
            method: "POST",
            url: "/api/credentials",
            headers: f.headers,
            payload: { provider: "deepseek", label: "Command test", apiKey: secret },
          })
        ).statusCode,
      ).toBe(201);
      const result = await f.started.running.commands.execute(f.context, {
        executable: process.execPath,
        args: [
          "-e",
          "const key=require('node:fs').readFileSync('secret.txt','utf8');process.stdout.write(key.slice(0,8));setTimeout(()=>{process.stdout.write(key.slice(8));console.error('token=unknown-test-secret')},25)",
        ],
      });
      const output = await f.started.running.commands.output(result.id, 0, 100);
      expect(JSON.stringify(output)).not.toContain(secret);
      expect(JSON.stringify(output)).not.toContain("unknown-test-secret");
      expect(JSON.stringify(output)).toContain("[Redacted]");
      const { outputPath } = await import("../../src/modules/commands/output.js");
      const disk = await readFile(outputPath(f.started.running.dataDir, result.id), "utf8");
      expect(disk).not.toContain(secret);
      expect(disk).not.toContain("unknown-test-secret");
      for (const table of [
        "command_executions",
        "resource_operations",
        "resource_events",
        "audit_logs",
      ])
        expect(
          JSON.stringify(f.started.running.sqlite.prepare(`SELECT * FROM ${table}`).all()),
        ).not.toContain(secret);
      f.started.running.sqlite
        .prepare("UPDATE command_executions SET ended_at = ? WHERE id = ?")
        .run(Date.now() - 8 * 24 * 60 * 60_000, result.id);
      expect(await f.started.running.commands.output(result.id, 0, 100)).toMatchObject({
        chunks: [],
        resyncRequired: true,
      });
      await f.started.running.commands.cleanup();
      await expect(
        readFile(outputPath(f.started.running.dataDir, result.id)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      f.started.running.sqlite
        .prepare("UPDATE command_executions SET ended_at = ? WHERE id = ?")
        .run(Date.now() - 31 * 24 * 60 * 60_000, result.id);
      await f.started.running.commands.cleanup();
      expect(
        f.started.running.sqlite
          .prepare("SELECT id FROM command_executions WHERE id = ?")
          .get(result.id),
      ).toBeUndefined();
      expect(
        f.started.running.sqlite
          .prepare("SELECT id FROM resource_operations WHERE id = ?")
          .get(result.operationId),
      ).toBeUndefined();
      expect(
        f.started.running.sqlite
          .prepare("SELECT last_seq FROM resource_streams WHERE stream_id = ?")
          .get(result.id),
      ).toEqual({ last_seq: 3 });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("publishes only externally visible commits and blocks roots after final event storage fails", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    const { openDatabase } = await import("../../src/db/client.js");
    const reader = openDatabase(f.started.running.dbPath);
    const committed: boolean[] = [];
    const listener = (event: { eventId: string }) => {
      committed.push(
        reader.sqlite.prepare("SELECT id FROM resource_events WHERE id = ?").get(event.eventId) !==
          undefined,
      );
    };
    f.started.running.commands.options.events.on(listener);
    try {
      f.started.running.sqlite.exec(
        "CREATE TRIGGER fail_command_finish BEFORE INSERT ON resource_events WHEN NEW.type = 'command.status' AND json_extract(NEW.payload_json, '$.status') = 'COMPLETED' BEGIN SELECT RAISE(FAIL, 'fixture-finish-failed'); END",
      );
      await expect(
        f.started.running.commands.execute(f.context, {
          executable: process.execPath,
          args: ["-e", "require('node:fs').writeFileSync('effect','done')"],
        }),
      ).rejects.toMatchObject({ code: "INTERNAL" });
      expect(await readFile(path.join(f.root, "effect"), "utf8")).toBe("done");
      expect(committed).toEqual([true, true]);
      expect(
        f.started.running.sqlite
          .prepare("SELECT status FROM resource_operations WHERE kind = 'command.run'")
          .get(),
      ).toEqual({ status: "RECONCILIATION_REQUIRED" });
      const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
      expect(
        acquireResourceLock(
          { db: f.started.running.db, now: () => Date.now() + 100_000 },
          {
            resourceType: "project",
            resourceId: "different-id",
            rootRealPath: f.project.realPath,
            owner: "fixture",
            executionId: "fixture",
            ttlMs: 1000,
          },
        ),
      ).toBeNull();
      f.started.running.sqlite.exec("DROP TRIGGER fail_command_finish");
      await f.started.running.commands.recover();
      expect(
        f.started.running.sqlite
          .prepare("SELECT status, reason_code FROM command_executions")
          .get(),
      ).toEqual({ status: "INTERRUPTED", reason_code: "RECOVERY_UNCONFIRMED" });
    } finally {
      f.started.running.commands.options.events.off(listener);
      reader.close();
      await stopAuthorizedServer(f.started);
    }
  });
});

it("stops on lease loss, preserves fencing, and accepts the Turn-owned lock without acquiring it twice", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    try {
      const { acquireResourceLock, releaseResourceLock } = await import(
        "../../src/modules/locks/service.js"
      );
      const inherited = acquireResourceLock(
        { db: f.started.running.db },
        {
          resourceType: "project",
          resourceId: f.project.id,
          rootRealPath: f.project.realPath,
          owner: f.context.clientSessionId,
          executionId: f.context.turnId,
          ttlMs: 5000,
        },
      );
      expect(inherited).not.toBeNull();
      if (!inherited) throw new Error("Missing fixture lock");
      const done = await f.started.running.commands.execute(
        { ...f.context, inheritedLock: inherited },
        { executable: process.execPath, args: ["-e", ""] },
      );
      expect(done.status).toBe("COMPLETED");
      const { findResourceLock } = await import("../../src/modules/locks/service.js");
      expect(
        findResourceLock(f.started.running.db, "project", f.project.id)?.expiresAt,
      ).toBeGreaterThan(Date.now());
      releaseResourceLock({ db: f.started.running.db }, inherited);
      updateTurnRow(f.started.running.db, f.context.turnId, {
        status: "COMPLETED",
        endedAt: Date.now(),
      });
      const nextTurn = createTurn(
        { db: f.started.running.db },
        { sessionId: f.context.sessionId, text: "lease fixture" },
      );
      updateTurnRow(f.started.running.db, nextTurn.turnId, { status: "RUNNING" });
      let clock = Date.now();
      Object.assign(f.started.running.commands.options, {
        now: () => clock,
        heartbeatMs: 20,
        lockTtlMs: 100,
      });
      let id = "";
      const pending = f.started.running.commands.execute(
        {
          ...f.context,
          toolCallId: "lease-loss",
          turnId: nextTurn.turnId,
          onCreated: (created) => {
            id = created;
          },
        },
        { executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      );
      await waitForCommand(
        async () => id !== "" && (await f.started.running.commands.read(id)).status === "RUNNING",
      );
      clock += 1000;
      expect(await pending).toMatchObject({ status: "INTERRUPTED", reasonCode: "LOCK_LOST" });
      const fresh = acquireResourceLock(
        { db: f.started.running.db, now: () => clock },
        {
          resourceType: "project",
          resourceId: f.project.id,
          rootRealPath: f.project.realPath,
          owner: "new",
          executionId: "new",
          ttlMs: 1000,
        },
      );
      expect(fresh).not.toBeNull();
      expect(releaseResourceLock({ db: f.started.running.db }, inherited)).toBe(false);
      expect(findResourceLock(f.started.running.db, "project", f.project.id)?.executionId).toBe(
        "new",
      );
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("keeps restart recovery from signalling a stored PID and preserves the conflict barrier", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    const { spawn } = await import("node:child_process");
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    try {
      const result = await f.started.running.commands.execute(f.context, {
        executable: process.execPath,
        args: ["-e", ""],
      });
      f.started.running.sqlite
        .prepare(
          "UPDATE command_executions SET status='RUNNING', process_identity_json=? WHERE id=?",
        )
        .run(
          JSON.stringify({ pid: unrelated.pid, instance: "old-instance", launchId: "unknown" }),
          result.id,
        );
      f.started.running.sqlite
        .prepare("UPDATE resource_operations SET status='WRITING' WHERE id=?")
        .run(result.operationId);
      await stopAuthorizedServer(f.started);
      const { startServer } = await import("../../src/bootstrap/start.js");
      const { getFreePort, createLogSink } = await import("../helpers.js");
      const restarted = await startServer({
        env: {
          LARNESS_DATA_DIR: f.started.running.dataDir,
          LARNESS_PORT: String(await getFreePort()),
        },
        logDestination: createLogSink().stream,
        turnRunner: false,
      });
      try {
        expect((await restarted.commands.read(result.id)).status).toBe("INTERRUPTED");
        const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
        expect(
          acquireResourceLock(
            { db: restarted.db, now: () => Date.now() + 100_000 },
            {
              resourceType: "project",
              resourceId: f.project.id,
              rootRealPath: f.project.realPath,
              owner: "fixture",
              executionId: "fixture",
              ttlMs: 1000,
            },
          ),
        ).toBeNull();
      } finally {
        await restarted.shutdown("restart-fixture");
      }
      const { alive } = await import("../../scripts/m2-poc/system.js");
      if (!unrelated.pid) throw new Error("Missing unrelated fixture PID");
      expect(await alive(unrelated.pid)).toBe(true);
    } finally {
      unrelated.kill("SIGKILL");
      await stopAuthorizedServer(f.started);
    }
  });
});

it("closes active commands on server shutdown and keeps output storage failures from becoming success", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    const { CommandOutputFile } = await import("../../src/modules/commands/output.js");
    const { vi } = await import("vitest");
    try {
      const failure = vi.spyOn(CommandOutputFile.prototype, "append").mockImplementation(() => {
        throw new Error("fixture-output-disk-failed");
      });
      const failed = await f.started.running.commands.execute(f.context, {
        executable: process.execPath,
        args: ["-e", "console.log('x'.repeat(1000));setInterval(()=>{},1000)"],
      });
      failure.mockRestore();
      expect(failed).toMatchObject({ status: "FAILED", reasonCode: "OUTPUT_FAILED" });
      let id = "";
      const pending = f.started.running.commands.execute(
        {
          ...f.context,
          toolCallId: "shutdown",
          onCreated: (created) => {
            id = created;
          },
        },
        { executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
      );
      await waitForCommand(
        async () => id !== "" && (await f.started.running.commands.read(id)).status === "RUNNING",
      );
      await f.started.running.shutdown("command-fixture");
      expect(await pending).toMatchObject({ status: "INTERRUPTED", reasonCode: "SERVER_SHUTDOWN" });
    } finally {
      vi.restoreAllMocks();
      await stopAuthorizedServer(f.started);
    }
  });
});

it("authorizes command subscriptions and replays committed command status events", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    const { default: WebSocket } = await import("ws");
    const socket = new WebSocket(`ws://127.0.0.1:${f.started.port}/ws`, {
      headers: { cookie: f.started.cookie, origin: f.started.origin },
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      let id = "";
      const pending = f.started.running.commands.execute(
        {
          ...f.context,
          onCreated: (created) => {
            id = created;
          },
        },
        {
          executable: process.execPath,
          args: ["-e", "setTimeout(()=>console.log('completed'),200)"],
        },
      );
      await waitForCommand(() => id !== "");
      socket.send(
        JSON.stringify({
          type: "subscribe",
          subscriptions: [{ topic: "command", resourceId: id, after: 0 }],
        }),
      );
      await waitForCommand(() => messages.some((message) => message.kind === "subscribed"));
      await pending;
      await waitForCommand(() =>
        messages.some(
          (message) =>
            message.type === "command.status" &&
            JSON.stringify(message.payload).includes("COMPLETED"),
        ),
      );
      await waitForCommand(() => messages.some((message) => message.kind === "command.output"));
      const streamed = messages.filter((message) => message.kind === "command.output");
      expect(streamed.map((message) => message.data).join("")).toBe("completed\n");
      const stored = await f.started.running.commands.output(id, 0, 500);
      expect(streamed.map((message) => message.cursor)).toEqual(
        stored.chunks.map((chunk) => chunk.cursor),
      );
      const replay = await f.started.running.app.inject({
        url: `/api/resource-events?streamId=${id}`,
        headers: f.headers,
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ currentSequence: 3, resyncRequired: false });
      expect(replay.json().items.map((event: { sequence: number }) => event.sequence)).toEqual([
        1, 2, 3,
      ]);
    } finally {
      socket.terminate();
      await stopAuthorizedServer(f.started);
    }
  });
});

it("uses the genuine standalone workspace and rejects invented environment or escaping cwd", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    try {
      const standalone = await createSession(
        { db: f.started.running.db, dataDir: f.started.running.dataDir },
        {},
      );
      const turn = createTurn(
        { db: f.started.running.db },
        { sessionId: standalone.id, text: "standalone" },
      );
      updateTurnRow(f.started.running.db, turn.turnId, { status: "RUNNING" });
      const context = {
        ...f.context,
        sessionId: standalone.id,
        turnId: turn.turnId,
        toolCallId: "standalone",
      };
      for (const extra of [{ cwd: "../" }, { env: { SECRET: "forged" } }])
        await expect(
          f.started.running.commands.execute(context, {
            executable: process.execPath,
            args: [],
            ...extra,
          }),
        ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      const result = await f.started.running.commands.execute(context, {
        executable: process.execPath,
        args: ["-e", "require('node:fs').writeFileSync('workspace.txt','standalone')"],
      });
      expect(result.status).toBe("COMPLETED");
      expect(await readFile(path.join(standalone.workspacePath, "workspace.txt"), "utf8")).toBe(
        "standalone",
      );
      expect(await f.started.running.commands.read(result.id)).toMatchObject({
        scope: { sessionId: standalone.id },
      });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("reports an escaped pipe holder as unconfirmed and keeps its root blocked after cancellation", async () => {
  await withTempDir(async (dir) => {
    const f = await commandFixture(dir);
    let escaped: number | undefined;
    try {
      const file = path.join(f.root, "escaped.json");
      let id = "";
      const pending = f.started.running.commands.execute(
        {
          ...f.context,
          onCreated: (created) => {
            id = created;
          },
        },
        {
          executable: process.execPath,
          args: [
            "-e",
            "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',process.stdout,process.stderr]});require('node:fs').writeFileSync(process.argv[1],JSON.stringify({pid:c.pid}));setInterval(()=>{},1000)",
            file,
          ],
        },
      );
      await waitForCommand(async () => {
        try {
          escaped = (JSON.parse(await readFile(file, "utf8")) as { pid: number }).pid;
          return true;
        } catch {
          return false;
        }
      });
      expect(await f.started.running.commands.cancel(id, f.context.clientSessionId)).toMatchObject({
        status: "INTERRUPTED",
        reasonCode: "STOP_UNCONFIRMED",
        truncated: true,
      });
      expect(await pending).toMatchObject({ status: "INTERRUPTED" });
      const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
      expect(
        acquireResourceLock(
          { db: f.started.running.db, now: () => Date.now() + 100_000 },
          {
            resourceType: "project",
            resourceId: f.project.id,
            rootRealPath: f.project.realPath,
            owner: "fixture",
            executionId: "fixture",
            ttlMs: 1000,
          },
        ),
      ).toBeNull();
    } finally {
      // This fixture deliberately creates an out-of-group process; only its
      // freshly recorded test PID is cleaned here, never by recovery code.
      if (escaped) {
        try {
          process.kill(escaped, "SIGKILL");
        } catch {
          /* already exited */
        }
      }
      await stopAuthorizedServer(f.started);
    }
  });
});
