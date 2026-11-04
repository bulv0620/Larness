import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { acquireResourceLock, releaseResourceLock } from "../../src/modules/locks/service.js";
import { createProject } from "../../src/modules/projects/service.js";
import { TerminalManager } from "../../src/modules/terminals/manager.js";
import { resolveManualShell } from "../../src/modules/terminals/shell.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

it("creates one real PTY by idempotency key, lists shared resources, and terminates explicitly", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "terminal-fixture",
    };
    try {
      expect(TerminalManager).toBeDefined();
      const denied = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers: { origin: f.origin },
        payload: { riskAcknowledged: true },
      });
      expect(denied.statusCode).toBe(401);
      const create = () =>
        f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers,
          payload: { scope: { projectId: p.id }, riskAcknowledged: true },
        });
      const first = await create();
      expect(first.statusCode).toBe(201);
      const terminal = first.json();
      expect(terminal.writeBlocked).toBe(false);
      expect(
        f.running.sqlite.prepare("SELECT shell FROM terminals WHERE id = ?").get(terminal.id),
      ).toEqual({ shell: await resolveManualShell() });
      const rename = (title: string, h = headers) =>
        f.running.app.inject({
          method: "POST",
          url: `/api/terminals/${terminal.id}/rename`,
          headers: h,
          payload: { title },
        });
      expect(
        (await rename("frontend shell", { origin: f.origin } as typeof headers)).statusCode,
      ).toBe(401);
      expect((await rename("bad\u001bname")).statusCode).toBe(400);
      expect((await rename("   ")).statusCode).toBe(400);
      expect((await rename("x".repeat(81))).statusCode).toBe(400);
      expect((await rename("frontend shell")).json().title).toBe("frontend shell");
      expect(
        (await f.running.app.inject({ url: `/api/terminals/${terminal.id}`, headers })).json()
          .title,
      ).toBe("frontend shell");
      expect(
        f.running.sqlite.prepare("SELECT title FROM terminals WHERE id = ?").get(terminal.id),
      ).toEqual({ title: "frontend shell" });

      const lock = acquireResourceLock(
        { db: f.running.db },
        {
          resourceType: "project",
          resourceId: p.id,
          owner: "test",
          executionId: "write-fixture",
          ttlMs: 30000,
        },
      );
      if (!lock) throw new Error("Expected project write lock");
      expect(
        (await f.running.app.inject({ url: `/api/terminals/${terminal.id}`, headers })).json()
          .writeBlocked,
      ).toBe(true);
      releaseResourceLock({ db: f.running.db }, { id: lock.id, fencingToken: lock.fencingToken });

      expect((await create()).json().id).toBe(terminal.id);
      expect(
        (await f.running.app.inject({ url: "/api/terminals", headers }))
          .json()
          .items.map((row: { id: string }) => row.id),
      ).toContain(terminal.id);
      const ended = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${terminal.id}/terminate`,
        headers,
        payload: { confirmed: true },
      });
      expect(ended.statusCode).toBe(200);
      expect(ended.json().status).toBe("TERMINATED");
      expect(f.running.sqlite.prepare("SELECT count(*) AS n FROM terminals").get()).toEqual({
        n: 1,
      });
      expect(
        f.running.sqlite
          .prepare("SELECT count(*) AS n FROM resource_locks WHERE expires_at > ?")
          .get(Date.now()),
      ).toEqual({ n: 0 });
      expect(
        (await f.running.app.inject({ method: "DELETE", url: `/api/projects/${p.id}`, headers }))
          .statusCode,
      ).toBe(200);
      expect((await f.running.app.inject({ url: "/api/terminals", headers })).json().items).toEqual(
        [],
      );
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});

async function until(check: () => boolean | Promise<boolean>) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("Terminal fixture timed out");
}
async function secondClient(f: Awaited<ReturnType<typeof startAuthorizedServer>>) {
  const pending = (
    await f.running.app.inject({
      method: "POST",
      url: "/api/pairing/requests",
      headers: { origin: f.origin },
      payload: {},
    })
  ).json();
  const approval = (await f.client.request("pairing.approve", {
    requestId: pending.requestId,
    decision: "allow_once",
  })) as { code: string };
  const result = await f.running.app.inject({
    method: "POST",
    url: "/api/pairing/redeem",
    headers: { origin: f.origin },
    payload: { requestId: pending.requestId, code: approval.code },
  });
  const raw = String(result.headers["set-cookie"]);
  return {
    cookie: `larness_session=${/larness_session=([^;]+)/.exec(raw)?.[1]}`,
    csrf: result.json().csrfToken as string,
  };
}
async function socketFor(
  f: Awaited<ReturnType<typeof startAuthorizedServer>>,
  cookie: string,
  id: string,
) {
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(`ws://127.0.0.1:${f.port}/ws`, {
    headers: { cookie, origin: f.origin },
  });
  const messages: Record<string, unknown>[] = [];
  socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
  await until(() => messages.some((message) => message.kind === "hello"));
  const connectionId = String(messages.find((message) => message.kind === "hello")?.connectionId);
  socket.send(
    JSON.stringify({
      type: "subscribe",
      subscriptions: [{ topic: "terminal", resourceId: id, after: 0 }],
    }),
  );
  await until(() => messages.some((message) => message.kind === "subscribed"));
  return {
    socket,
    messages,
    connectionId,
    async input(generation: number, sequence: number, data: string) {
      const start = messages.length;
      socket.send(
        JSON.stringify({
          type: "terminal.input",
          terminalId: id,
          leaseGeneration: generation,
          inputSequence: sequence,
          data,
        }),
      );
      await until(() =>
        messages
          .slice(start)
          .some((message) => message.kind === "terminal.input.ack" || message.kind === "error"),
      );
      return messages
        .slice(start)
        .find((message) => message.kind === "terminal.input.ack" || message.kind === "error");
    },
  };
}
it("binds input and resize to one of two authenticated connections, fences replays and releases on disconnect/expiry", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const other = await secondClient(f);
    const root = path.join(dir, "project");
    await mkdir(root);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "two-clients",
    };
    const secondHeaders = { cookie: other.cookie, origin: f.origin, "x-csrf-token": other.csrf };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { scope: { projectId: p.id }, riskAcknowledged: true },
      })
    ).json();
    const a = await socketFor(f, f.cookie, created.id),
      b = await socketFor(f, other.cookie, created.id);
    const lease = (
      h: typeof secondHeaders,
      connectionId: string,
      action = "acquire",
      leaseGeneration?: number,
    ) =>
      f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/lease`,
        headers: h,
        payload: { action, connectionId, leaseGeneration },
      });
    try {
      const first = await lease(headers, a.connectionId);
      expect(first.statusCode).toBe(200);
      const gen = first.json().lease.generation;
      expect((await lease(secondHeaders, b.connectionId)).statusCode).toBe(409);
      expect((await lease(headers, b.connectionId)).statusCode).toBe(403);
      expect(await a.input(gen, 1, "printf X >> marker\r")).toMatchObject({
        kind: "terminal.input.ack",
        accepted: true,
      });
      expect(await a.input(gen, 1, "printf X >> marker\r")).toMatchObject({ accepted: false });
      await until(async () => {
        try {
          return (await readFile(path.join(root, "marker"), "utf8")) === "X";
        } catch {
          return false;
        }
      });
      expect(await b.input(gen, 1, "printf BAD >> marker\r")).toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      expect(await a.input(gen, 3, "echo gap\r")).toMatchObject({ code: "VALIDATION_ERROR" });
      const resized = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/resize`,
        headers,
        payload: { connectionId: a.connectionId, leaseGeneration: gen, cols: 103, rows: 37 },
      });
      expect(resized.statusCode).toBe(200);
      await a.input(gen, 2, "stty size > dimensions\r");
      await until(async () => {
        try {
          return /37\s+103/.test(await readFile(path.join(root, "dimensions"), "utf8"));
        } catch {
          return false;
        }
      });
      expect((await lease(headers, a.connectionId, "release", gen)).statusCode).toBe(200);
      const next = (await lease(secondHeaders, b.connectionId)).json().lease.generation;
      expect(next).toBeGreaterThan(gen);
      expect(await a.input(gen, 3, "echo OLD\r")).toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      await b.input(next, 1, "printf Y >> marker\r");
      await until(async () => (await readFile(path.join(root, "marker"), "utf8")) === "XY");
      b.socket.close();
      await until(async () => !(await f.running.terminals.read(created.id)).lease);
      const handed = (await lease(headers, a.connectionId)).json().lease.generation;
      expect(handed).toBeGreaterThan(next);
      const clock = Date.now() + 31000;
      f.running.terminals.options.now = () => clock;
      f.running.terminals.expireLeases();
      expect(await a.input(handed, 1, "echo expired\r")).toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
      const fresh = (await lease(headers, a.connectionId)).json().lease.generation;
      expect(fresh).toBeGreaterThan(handed);
      for (let sequence = 1; sequence <= 8; sequence++)
        expect(await a.input(fresh, sequence, " ".repeat(8192))).toMatchObject({ accepted: true });
      expect(await a.input(fresh, 9, " ".repeat(8192))).toMatchObject({ code: "RATE_LIMITED" });
      expect(await a.input(fresh, 9, "🦊".repeat(3000))).toMatchObject({
        code: "VALIDATION_ERROR",
      });
      const replay = await f.running.app.inject({
        url: `/api/resource-events?streamId=${created.id}`,
        headers,
      });
      expect(replay.statusCode).toBe(200);
      expect(
        replay.json().items.some((event: { type: string }) => event.type === "terminal.lease"),
      ).toBe(true);
      const output = await f.running.app.inject({
        url: `/api/terminals/${created.id}/output`,
        headers,
      });
      expect(output.json().chunks.length).toBeGreaterThan(0);
      expect(JSON.stringify(a.messages)).toContain("terminal.output");
    } finally {
      a.socket.terminate();
      b.socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
});

it("cleans a real foreground job process group and its TERM/HUP-resistant child before reporting termination", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "foreground-job",
    };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { scope: { projectId: p.id }, riskAcknowledged: true },
      })
    ).json();
    const connection = await socketFor(f, f.cookie, created.id);
    try {
      const control = (
        await f.running.app.inject({
          method: "POST",
          url: `/api/terminals/${created.id}/lease`,
          headers,
          payload: { action: "acquire", connectionId: connection.connectionId },
        })
      ).json().lease;
      const child =
        "process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});require('node:fs').writeFileSync('child-ready','yes');setInterval(()=>{},1000)";
      const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');process.on('SIGTERM',()=>{});process.on('SIGHUP',()=>{});const c=spawn(process.execPath,['-e',${JSON.stringify(child)}],{stdio:'ignore'});const t=setInterval(()=>{if(fs.existsSync('child-ready')){clearInterval(t);fs.writeFileSync('job-pids',JSON.stringify({parent:process.pid,child:c.pid}));}},10);setInterval(()=>{},1000)`;
      const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
      await connection.input(
        control.generation,
        1,
        `${quote(process.execPath)} -e ${quote(code)}\r`,
      );
      let pids: { parent: number; child: number } | undefined;
      await until(async () => {
        try {
          pids = JSON.parse(await readFile(path.join(root, "job-pids"), "utf8"));
          return true;
        } catch {
          return false;
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const rootPid = (
        JSON.parse(
          (
            f.running.sqlite
              .prepare("SELECT process_identity_json FROM terminals WHERE id=?")
              .get(created.id) as { process_identity_json: string }
          ).process_identity_json,
        ) as { pid: number }
      ).pid;
      const result = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/terminate`,
        headers,
        payload: { confirmed: true },
      });
      expect(result.json()).toMatchObject({ status: "TERMINATED" });
      const { alive } = await import("../../scripts/m2-poc/system.js");
      for (const pid of [rootPid, pids?.parent, pids?.child]) {
        if (!pid) throw new Error("Missing fixture PID");
        expect(await alive(pid)).toBe(false);
      }
    } finally {
      connection.socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
});

it("keeps dev roles unique and alive across Turn completion while allowing protected file edits", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(root, "note.txt"), "old");
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const { createSession } = await import("../../src/modules/sessions/service.js");
    const { createTurn } = await import("../../src/modules/sessions/turns.js");
    const { updateTurnRow } = await import("../../src/modules/sessions/repository.js");
    const session = await createSession(
      { db: f.running.db, dataDir: f.running.dataDir },
      { projectId: p.id },
    );
    const client = (
      await f.running.app.inject({ url: "/api/auth/session", headers: { cookie: f.cookie } })
    ).json().clientSessionId;
    const turn = createTurn(
      { db: f.running.db },
      { sessionId: session.id, text: "dev fixture", clientSessionId: client },
    );
    updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
    const controller = new AbortController();
    const context = {
      clientSessionId: client,
      projectId: p.id,
      sessionId: session.id,
      turnId: turn.turnId,
      toolCallId: "frontend",
      policySnapshotId: "fixture-approved-policy",
      assertAuthorized: () => {},
      signal: controller.signal,
    };
    const manager = f.running.terminals;
    const program = {
      role: "frontend",
      executable: process.execPath,
      args: ["-e", "setInterval(()=>{},1000)"],
    };
    try {
      const first = await manager.createDev(context, program);
      expect((await manager.createDev({ ...context, toolCallId: "retry" }, program)).id).toBe(
        first.id,
      );
      await expect(
        manager.createDev(
          { ...context, toolCallId: "different" },
          { ...program, args: ["-e", "console.log('different')"] },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const second = await manager.createDev(
        { ...context, toolCallId: "backend" },
        { ...program, role: "backend" },
      );
      expect(second.id).not.toBe(first.id);
      const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
      const opened = (
        await f.running.app.inject({ url: `/api/files?projectId=${p.id}&path=note.txt`, headers })
      ).json();
      const saved = await f.running.app.inject({
        method: "PUT",
        url: "/api/files",
        headers: { ...headers, "idempotency-key": "dev-edit" },
        payload: {
          scope: { projectId: p.id },
          path: "note.txt",
          content: "new",
          expectedVersion: opened.version,
        },
      });
      expect(saved.statusCode).toBe(200);
      expect(await readFile(path.join(root, "note.txt"), "utf8")).toBe("new");
      expect(
        (await f.running.app.inject({ method: "DELETE", url: `/api/projects/${p.id}`, headers }))
          .statusCode,
      ).toBe(409);
      updateTurnRow(f.running.db, turn.turnId, { status: "COMPLETED", endedAt: Date.now() });
      controller.abort();
      expect((await manager.read(first.id)).status).toBe("RUNNING");
      expect((await manager.read(second.id)).status).toBe("RUNNING");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});
it("rolls bounded terminal output by cursor under individual/global quotas and expiry", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const { TerminalOutput } = await import("../../src/modules/terminals/output.js");
    const { randomUUID } = await import("node:crypto");
    try {
      const a = new TerminalOutput(f.running.dataDir, `term_${randomUUID()}`, {
        perTerminal: 4096,
        total: 6144,
      });
      const b = new TerminalOutput(f.running.dataDir, `term_${randomUUID()}`, {
        perTerminal: 4096,
        total: 6144,
      });
      for (let i = 0; i < 12; i++) {
        a.append("a".repeat(1000), Date.now());
        b.append("b".repeat(1000), Date.now());
      }
      const replay = a.read(0, 500, 12);
      expect(replay.oldestCursor).toBeGreaterThan(1);
      expect(replay.resyncRequired).toBe(true);
      expect(replay.chunks.at(-1)?.cursor).toBe(12);
      const { readdir, stat } = await import("node:fs/promises");
      let bytes = 0;
      for (const name of await readdir(a.directory)) {
        const info = await stat(path.join(a.directory, name));
        expect(info.mode & 0o777).toBe(0o600);
        bytes += info.size;
      }
      expect(bytes).toBeLessThanOrEqual(6144);
      a.prune(Date.now() + 8 * 86400000);
      expect(a.read(0, 500, 12)).toMatchObject({
        chunks: [],
        nextCursor: 12,
        resyncRequired: true,
      });
      expect(() => a.read(13, 500, 12)).toThrow();
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});

it("marks old terminal execution interrupted without signalling an unrelated stored PID and retains the root barrier", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "recover-terminal",
    };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { scope: { projectId: p.id }, riskAcknowledged: true },
      })
    ).json();
    const { spawn } = await import("node:child_process");
    const unrelated = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      stdio: "ignore",
    });
    try {
      await f.running.terminals.close();
      f.running.sqlite
        .prepare("UPDATE terminals SET status='RUNNING',process_identity_json=? WHERE id=?")
        .run(JSON.stringify({ pid: unrelated.pid, instance: "old" }), created.id);
      f.running.sqlite
        .prepare(
          "UPDATE resource_operations SET status='WRITING' WHERE id=(SELECT operation_id FROM terminals WHERE id=?)",
        )
        .run(created.id);
      await stopAuthorizedServer(f);
      const { startServer } = await import("../../src/bootstrap/start.js");
      const { getFreePort, createLogSink } = await import("../helpers.js");
      const restarted = await startServer({
        env: { LARNESS_DATA_DIR: f.running.dataDir, LARNESS_PORT: String(await getFreePort()) },
        logDestination: createLogSink().stream,
        turnRunner: false,
      });
      try {
        expect(await restarted.terminals.read(created.id)).toMatchObject({
          status: "INTERRUPTED",
          reasonCode: "RECOVERY_UNCONFIRMED",
          lease: null,
        });
        const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
        expect(
          acquireResourceLock(
            { db: restarted.db, now: () => Date.now() + 100000 },
            {
              resourceType: "project",
              resourceId: p.id,
              rootRealPath: p.realPath,
              owner: "fixture",
              executionId: "fixture",
              ttlMs: 1000,
            },
          ),
        ).toBeNull();
        if (!unrelated.pid) throw new Error("Missing fixture PID");
        const { alive } = await import("../../scripts/m2-poc/system.js");
        expect(await alive(unrelated.pid)).toBe(true);
      } finally {
        await restarted.shutdown("test");
      }
    } finally {
      unrelated.kill("SIGKILL");
      await stopAuthorizedServer(f);
    }
  });
});
it("fails closed on terminal creation audit failure and retains no partial resource intent", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    try {
      f.running.sqlite.exec(
        "CREATE TRIGGER fail_terminal_audit BEFORE INSERT ON audit_logs WHEN NEW.action='terminal.created' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      );
      const result = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers: {
          cookie: f.cookie,
          origin: f.origin,
          "x-csrf-token": f.csrf,
          "idempotency-key": "fail-audit",
        },
        payload: { riskAcknowledged: true },
      });
      expect(result.statusCode).toBe(500);
      expect(result.json().error.code).toBe("INTERNAL");
      for (const table of ["terminals", "terminal_leases"]) {
        expect(f.running.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({
          n: 0,
        });
      }
      expect(
        f.running.sqlite
          .prepare("SELECT count(*) AS n FROM resource_operations WHERE kind='terminal.create'")
          .get(),
      ).toEqual({ n: 0 });
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});

it("authorizes genuine standalone/global workspaces and rejects malformed or unconfirmed creation", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const { createSession } = await import("../../src/modules/sessions/service.js");
    const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
    // Preserve coverage for pre-ADR-032 standalone sessions; new sessions now share the default root.
    const legacyRoot = path.join(f.running.dataDir, "sessions", session.id, "workspace");
    await mkdir(legacyRoot, { recursive: true });
    f.running.sqlite
      .prepare("UPDATE sessions SET workspace_path = ? WHERE id = ?")
      .run(legacyRoot, session.id);

    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "scope-fixture",
    };
    try {
      const first = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { scope: { sessionId: session.id }, riskAcknowledged: true },
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({ workspaceSessionId: session.id, projectId: null });
      const conflict = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      });
      expect(conflict.statusCode).toBe(409);
      const global = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers: { ...headers, "idempotency-key": "global-fixture" },
        payload: { riskAcknowledged: true },
      });
      expect(global.json()).toMatchObject({
        projectId: null,
        workspaceSessionId: null,
        status: "RUNNING",
      });
      const events = await f.running.app.inject({
        url: `/api/resource-events?streamId=${global.json().id}`,
        headers,
      });
      expect(events.statusCode).toBe(200);
      for (const payload of [
        {},
        { riskAcknowledged: true, cwd: "../" },
        { riskAcknowledged: true, env: { PATH: "/outside" } },
        { riskAcknowledged: true, sourceSessionId: session.id },
      ]) {
        const result = await f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers: { ...headers, "idempotency-key": String(Math.random()) },
          payload,
        });
        expect(result.statusCode).toBeGreaterThanOrEqual(400);
      }
      const csrf = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${first.json().id}/terminate`,
        headers: { cookie: f.cookie, origin: f.origin },
        payload: { confirmed: true },
      });
      expect(csrf.statusCode).toBe(403);
      expect(csrf.json().error.code).toBe("CSRF_INVALID");
      const origin = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${first.json().id}/terminate`,
        headers: { ...headers, origin: "https://untrusted.example" },
        payload: { confirmed: true },
      });
      expect(origin.statusCode).toBe(403);
      expect((await f.running.terminals.read(first.json().id)).status).toBe("RUNNING");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});
it("streams redacted PTY output with filtered environment and persists a real nonzero exit", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const { writeFile } = await import("node:fs/promises");
    const secret = "sk-pty-test-known-secret";
    await writeFile(path.join(root, "value.txt"), secret);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const { createSession } = await import("../../src/modules/sessions/service.js");
    const { createTurn } = await import("../../src/modules/sessions/turns.js");
    const { updateTurnRow } = await import("../../src/modules/sessions/repository.js");
    const session = await createSession(
      { db: f.running.db, dataDir: f.running.dataDir },
      { projectId: p.id },
    );
    const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
    const client = (await f.running.app.inject({ url: "/api/auth/session", headers })).json()
      .clientSessionId;
    const turn = createTurn(
      { db: f.running.db },
      { sessionId: session.id, text: "output fixture", clientSessionId: client },
    );
    updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
    const previous = process.env.LARNESS_PTY_TEST_SECRET;
    process.env.LARNESS_PTY_TEST_SECRET = "host-env-test-secret";
    try {
      expect(
        (
          await f.running.app.inject({
            method: "POST",
            url: "/api/credentials",
            headers,
            payload: { provider: "deepseek", label: "PTY test", apiKey: secret },
          })
        ).statusCode,
      ).toBe(201);
      const row = await f.running.terminals.createDev(
        {
          clientSessionId: client,
          projectId: p.id,
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "output",
          policySnapshotId: "fixture-policy",
          assertAuthorized: () => {},
        },
        {
          role: "output",
          executable: process.execPath,
          args: [
            "-e",
            "const key=require('node:fs').readFileSync('value.txt','utf8');process.stdout.write(key.slice(0,8));setTimeout(()=>{console.log(key.slice(8));console.log('token=unknown-pty-secret');console.log(process.env.LARNESS_PTY_TEST_SECRET??'filtered');console.log('COMMAND_EXIT_9');process.exitCode=9},100)",
          ],
        },
      );
      await until(async () =>
        JSON.stringify(await f.running.terminals.output(row.id, 0, 500)).includes("COMMAND_EXIT_9"),
      );
      expect(await f.running.terminals.read(row.id)).toMatchObject({
        status: "RUNNING",
        exitCode: null,
      });
      const connection = await socketFor(f, f.cookie, row.id);
      try {
        const lease = await f.running.terminals.lease(row.id, client, {
          action: "acquire",
          connectionId: connection.connectionId,
        });
        if (!lease.lease) throw new Error("Missing terminal lease");
        await connection.input(lease.lease.generation, 1, "exit 9\r");
        await until(async () => (await f.running.terminals.read(row.id)).status === "EXITED");
        expect(await f.running.terminals.read(row.id)).toMatchObject({ exitCode: 9 });
      } finally {
        connection.socket.terminate();
      }
      const output = await f.running.terminals.output(row.id, 0, 500);
      expect(JSON.stringify(output)).not.toContain(secret);
      expect(JSON.stringify(output)).not.toContain("unknown-pty-secret");
      expect(JSON.stringify(output)).not.toContain("host-env-test-secret");
      expect(JSON.stringify(output)).toContain("filtered");
      const metadata = JSON.stringify(f.running.sqlite.prepare("SELECT * FROM terminals").all());
      expect(metadata).not.toContain(secret);
      expect(metadata).not.toContain("unknown-pty-secret");
    } finally {
      if (previous === undefined) delete process.env.LARNESS_PTY_TEST_SECRET;
      else process.env.LARNESS_PTY_TEST_SECRET = previous;
      await stopAuthorizedServer(f);
    }
  });
});

it("revokes a logged-out connection lease immediately while its shared PTY remains alive", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const other = await secondClient(f);
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "logout-terminal",
    };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      })
    ).json();
    const a = await socketFor(f, f.cookie, created.id),
      b = await socketFor(f, other.cookie, created.id);
    try {
      const own = (
        await f.running.app.inject({
          method: "POST",
          url: `/api/terminals/${created.id}/lease`,
          headers,
          payload: { action: "acquire", connectionId: a.connectionId },
        })
      ).json().lease;
      const loggedOut = await f.running.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers,
        payload: {},
      });
      expect(loggedOut.statusCode).toBe(204);
      const next = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/lease`,
        headers: { cookie: other.cookie, origin: f.origin, "x-csrf-token": other.csrf },
        payload: { action: "acquire", connectionId: b.connectionId },
      });
      expect(next.statusCode).toBe(200);
      expect(next.json().lease.generation).toBeGreaterThan(own.generation);
      expect((await f.running.terminals.read(created.id)).status).toBe("RUNNING");
      expect(
        (await f.running.app.inject({ url: `/api/terminals/${created.id}/output`, headers }))
          .statusCode,
      ).toBe(401);
    } finally {
      a.socket.terminate();
      b.socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
});
it("stops real PTYs on output failure or terminal result commit failure and preserves uncertainty barriers", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const { TerminalOutput } = await import("../../src/modules/terminals/output.js");
    const { vi } = await import("vitest");
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "output-failure",
    };
    try {
      const fault = vi.spyOn(TerminalOutput.prototype, "append").mockImplementation(() => {
        throw new Error("fixture-output-failed");
      });
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      });
      await until(
        () =>
          !!f.running.sqlite.prepare("SELECT id FROM terminals WHERE status='INTERRUPTED'").get(),
      );
      fault.mockRestore();
      expect(
        f.running.sqlite
          .prepare("SELECT status FROM resource_operations WHERE kind='terminal.create'")
          .get(),
      ).toEqual({ status: "RECONCILIATION_REQUIRED" });
      const root = path.join(dir, "project");
      await mkdir(root);
      const p = await createProject({ db: f.running.db }, { rootPath: root });
      const created = (
        await f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers: { ...headers, "idempotency-key": "commit-failure" },
          payload: { scope: { projectId: p.id }, riskAcknowledged: true },
        })
      ).json();
      const identity = JSON.parse(
        (
          f.running.sqlite
            .prepare("SELECT process_identity_json FROM terminals WHERE id=?")
            .get(created.id) as { process_identity_json: string }
        ).process_identity_json,
      ) as { pid: number };
      const finished: unknown[] = [];
      f.running.terminals.options.events.on((event) => {
        if (event.streamId === created.id && event.type === "terminal.exit") finished.push(event);
      });
      f.running.sqlite.exec(
        "CREATE TRIGGER fail_terminal_result BEFORE UPDATE ON terminals WHEN NEW.status='TERMINATED' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      );
      const response = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/terminate`,
        headers,
        payload: { confirmed: true },
      });
      expect(response.json()).toMatchObject({
        status: "INTERRUPTED",
        reasonCode: "RESULT_RECORD_FAILED",
      });
      expect(finished).toHaveLength(0);
      const { alive } = await import("../../scripts/m2-poc/system.js");
      expect(await alive(identity.pid)).toBe(false);
      expect(
        f.running.sqlite
          .prepare(
            "SELECT status FROM resource_operations WHERE id=(SELECT operation_id FROM terminals WHERE id=?)",
          )
          .get(created.id),
      ).toEqual({ status: "RECONCILIATION_REQUIRED" });
      const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
      expect(
        acquireResourceLock(
          { db: f.running.db, now: () => Date.now() + 100000 },
          {
            resourceType: "project",
            resourceId: p.id,
            rootRealPath: p.realPath,
            owner: "fixture",
            executionId: "fixture",
            ttlMs: 1000,
          },
        ),
      ).toBeNull();
    } finally {
      vi.restoreAllMocks();
      await stopAuthorizedServer(f);
    }
  });
});

it("server shutdown closes an active PTY and input connection before closing SQLite", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "shutdown-terminal",
    };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      })
    ).json();
    const connection = await socketFor(f, f.cookie, created.id);
    const pid = JSON.parse(
      (
        f.running.sqlite
          .prepare("SELECT process_identity_json FROM terminals WHERE id=?")
          .get(created.id) as { process_identity_json: string }
      ).process_identity_json,
    ).pid as number;
    const dbPath = f.running.sqlite.name;
    try {
      await f.running.shutdown("terminal-shutdown-test");
      await until(() => connection.socket.readyState === 3);
      const { alive } = await import("../../scripts/m2-poc/system.js");
      expect(await alive(pid)).toBe(false);
      const { openDatabase } = await import("../../src/db/client.js");
      const reopened = openDatabase(dbPath);
      try {
        expect(
          reopened.sqlite
            .prepare("SELECT status,reason_code FROM terminals WHERE id=?")
            .get(created.id),
        ).toEqual({ status: "TERMINATED", reason_code: "SERVER_SHUTDOWN" });
        expect(
          reopened.sqlite
            .prepare("SELECT owner_type FROM terminal_leases WHERE terminal_id=?")
            .get(created.id),
        ).toEqual({ owner_type: null });
      } finally {
        reopened.close();
      }
    } finally {
      connection.socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
});

it("keeps an in-memory root barrier if both terminal finalization and durable reconciliation writes fail", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const p = await createProject({ db: f.running.db }, { rootPath: root });
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "double-failure",
    };
    try {
      const created = (
        await f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers,
          payload: { scope: { projectId: p.id }, riskAcknowledged: true },
        })
      ).json();
      f.running.sqlite.exec(
        "CREATE TRIGGER fail_all_terminal_results BEFORE UPDATE ON terminals WHEN NEW.status IN ('TERMINATED','INTERRUPTED') BEGIN SELECT RAISE(ABORT,'fixture'); END; CREATE TRIGGER fail_terminal_barrier BEFORE UPDATE ON resource_operations WHEN NEW.status='RECONCILIATION_REQUIRED' BEGIN SELECT RAISE(ABORT,'fixture'); END",
      );
      const result = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/terminate`,
        headers,
        payload: { confirmed: true },
      });
      expect(result.statusCode).toBe(500);
      await expect(f.running.terminals.read(created.id)).rejects.toMatchObject({
        code: "RESOURCE_UNAVAILABLE",
      });
      const { acquireResourceLock } = await import("../../src/modules/locks/service.js");
      expect(
        acquireResourceLock(
          { db: f.running.db, now: () => Date.now() + 100000 },
          {
            resourceType: "project",
            resourceId: p.id,
            rootRealPath: p.realPath,
            owner: "fixture",
            executionId: "fixture",
            ttlMs: 1000,
          },
        ),
      ).toBeNull();
      expect(
        (
          await f.running.app.inject({
            method: "POST",
            url: "/api/terminals",
            headers: { ...headers, "idempotency-key": "must-stay-blocked" },
            payload: { scope: { projectId: p.id }, riskAcknowledged: true },
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});

it("expires only safe terminal metadata at 30 days, retaining active resources, stream sequences and workspace files", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "metadata-retention",
    };
    try {
      const ended = (
        await f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers,
          payload: { riskAcknowledged: true },
        })
      ).json();
      await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${ended.id}/terminate`,
        headers,
        payload: { confirmed: true },
      });
      const live = (
        await f.running.app.inject({
          method: "POST",
          url: "/api/terminals",
          headers: { ...headers, "idempotency-key": "retain-active" },
          payload: { riskAcknowledged: true },
        })
      ).json();
      const sequence = f.running.sqlite
        .prepare("SELECT last_seq FROM resource_streams WHERE stream_id=?")
        .get(ended.id);
      const { writeFile } = await import("node:fs/promises");
      const workspaceFile = path.join(
        f.running.dataDir,
        "sessions",
        "global-terminal",
        "workspace",
        "keep.txt",
      );
      await writeFile(workspaceFile, "keep");
      const future = Date.now() + 31 * 86400000;
      f.running.terminals.options.now = () => future;
      await f.running.terminals.cleanup();
      expect(
        f.running.sqlite.prepare("SELECT id FROM terminals WHERE id=?").get(ended.id),
      ).toBeUndefined();
      expect(
        f.running.sqlite
          .prepare("SELECT terminal_id FROM terminal_leases WHERE terminal_id=?")
          .get(ended.id),
      ).toBeUndefined();
      expect(
        f.running.sqlite
          .prepare("SELECT last_seq FROM resource_streams WHERE stream_id=?")
          .get(ended.id),
      ).toEqual(sequence);
      expect((await f.running.terminals.read(live.id)).status).toBe("RUNNING");
      expect(await readFile(workspaceFile, "utf8")).toBe("keep");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});

it("quarantines a native spawn exception after a real PTY was created instead of assuming no process exists", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const { spawn } = await import("node-pty");
    const spawned: { pty?: ReturnType<typeof spawn> } = {};
    f.running.terminals.options.spawnPty = (program, args, options) => {
      spawned.pty = spawn(program, args, options);
      throw new Error("fixture-after-spawn");
    };
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "spawn-uncertainty",
    };
    try {
      const result = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      });
      expect(result.statusCode).toBe(409);
      expect(f.running.sqlite.prepare("SELECT status,reason_code FROM terminals").get()).toEqual({
        status: "INTERRUPTED",
        reason_code: "SPAWN_UNCONFIRMED",
      });
      expect(
        f.running.sqlite
          .prepare("SELECT status FROM resource_operations WHERE kind='terminal.create'")
          .get(),
      ).toEqual({ status: "RECONCILIATION_REQUIRED" });
      if (!spawned.pty) throw new Error("Missing actual fixture PTY");
      const { alive } = await import("../../scripts/m2-poc/system.js");
      expect(await alive(spawned.pty.pid)).toBe(true);
      expect(
        (
          await f.running.app.inject({
            method: "POST",
            url: "/api/terminals",
            headers: { ...headers, "idempotency-key": "must-not-spawn-again" },
            payload: { riskAcknowledged: true },
          })
        ).statusCode,
      ).toBe(409);
    } finally {
      const child = spawned.pty;
      if (child) {
        const exited = new Promise<void>((resolve) => child.onExit(() => resolve()));
        child.kill("SIGKILL");
        await exited;
      }
      await stopAuthorizedServer(f);
    }
  });
});

it("does not implicitly overwrite a live reserved agent principal through a human lease request", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const headers = {
      cookie: f.cookie,
      origin: f.origin,
      "x-csrf-token": f.csrf,
      "idempotency-key": "principal-fence",
    };
    const created = (
      await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers,
        payload: { riskAcknowledged: true },
      })
    ).json();
    const connection = await socketFor(f, f.cookie, created.id);
    try {
      const client = (await f.running.app.inject({ url: "/api/auth/session", headers })).json()
        .clientSessionId;
      f.running.sqlite
        .prepare(
          "UPDATE terminal_leases SET generation=7,owner_type='agent',owner_client_session_id=?,owner_connection_id=NULL,expires_at=? WHERE terminal_id=?",
        )
        .run(client, Date.now() + 30000, created.id);
      f.running.terminals.expireLeases();
      expect((await f.running.terminals.read(created.id)).lease?.ownerType).toBe("agent");
      const result = await f.running.app.inject({
        method: "POST",
        url: `/api/terminals/${created.id}/lease`,
        headers,
        payload: { action: "acquire", connectionId: connection.connectionId },
      });
      expect(result.statusCode).toBe(409);
      expect(result.json().error.code).toBe("TERMINAL_LEASE_REQUIRED");
      expect(await connection.input(7, 1, "echo forbidden\r")).toMatchObject({
        code: "TERMINAL_LEASE_REQUIRED",
      });
    } finally {
      connection.socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
});
