import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { createPatch } from "diff";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { createTerminalControlTools } from "../../src/modules/agent/terminalControlTool.js";
import { createTerminalTools } from "../../src/modules/agent/terminalTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { acquireResourceLock, releaseResourceLock } from "../../src/modules/locks/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer } from "../support/server.js";

it("shares a stable root for new default sessions without relocating legacy sessions or deleting files", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const options = { db: f.running.db, dataDir: f.running.dataDir };
      const a = await createSession(options, {});
      await writeFile(path.join(a.workspacePath, "keep.txt"), "keep");
      const b = await createSession(options, {});
      expect(b.workspacePath).toBe(a.workspacePath);
      expect(a.workspaceKind).toBe("default");
      expect(await readFile(path.join(b.workspacePath, "keep.txt"), "utf8")).toBe("keep");
      const legacy = path.join(f.running.dataDir, "sessions", a.id, "workspace");
      await mkdir(legacy, { recursive: true });
      await writeFile(path.join(legacy, "legacy.txt"), "legacy");
      f.running.sqlite
        .prepare("UPDATE sessions SET workspace_path = ? WHERE id = ?")
        .run(legacy, a.id);
      const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
      const detail = await f.running.app.inject({ url: `/api/sessions/${a.id}`, headers });
      expect(detail.json()).toMatchObject({ workspacePath: legacy, workspaceKind: "session" });
      const oldFile = await f.running.app.inject({
        url: `/api/files?sessionId=${a.id}&path=legacy.txt`,
        headers,
      });
      expect(oldFile.json().content).toBe("legacy");
      expect(await readFile(path.join(b.workspacePath, "keep.txt"), "utf8")).toBe("keep");
    } finally {
      await f.running.shutdown("test");
    }
  });
});

it("authorizes the exact default file root, shares events across session aliases and starts a real terminal there", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
    try {
      const listing = await f.running.app.inject({ url: "/api/workspaces/default/files", headers });
      expect(listing.statusCode).toBe(200);
      expect(
        (
          await f.running.app.inject({
            url: "/api/workspaces/default/files",
            headers: { origin: f.origin },
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (await f.running.app.inject({ url: "/api/workspaces/other/files", headers })).statusCode,
      ).toBe(400);
      const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      await writeFile(path.join(session.workspacePath, "note.txt"), "before");
      const read = await f.running.app.inject({
        url: "/api/files?workspace=default&path=note.txt",
        headers,
      });
      expect(read.json().content).toBe("before");
      const saved = await f.running.app.inject({
        method: "PUT",
        url: "/api/files",
        headers,
        payload: {
          scope: { workspace: "default" },
          path: "note.txt",
          content: "after",
          expectedVersion: read.json().version,
        },
      });
      expect(saved.statusCode).toBe(200);
      const alias = await f.running.app.inject({
        url: `/api/files?sessionId=${session.id}&path=note.txt`,
        headers,
      });
      expect(alias.json().content).toBe("after");
      const events = await f.running.app.inject({
        url: "/api/resource-events?streamId=file:workspace:default&after=0",
        headers,
      });
      expect(events.statusCode).toBe(200);
      expect(
        events.json().items.some((item: { type: string }) => item.type === "file.changed"),
      ).toBe(true);
      expect(
        (
          await f.running.app.inject({
            url: "/api/files?workspace=default&path=../../../config.json",
            headers,
          })
        ).statusCode,
      ).toBe(400);
      const terminal = await f.running.app.inject({
        method: "POST",
        url: "/api/terminals",
        headers: { ...headers, "idempotency-key": "default-shell" },
        payload: { scope: { workspace: "default" }, riskAcknowledged: true },
      });
      expect(terminal.statusCode).toBe(201);
      expect(terminal.json()).toMatchObject({
        cwd: await realpath(session.workspacePath),
        projectId: null,
        workspaceSessionId: null,
      });
    } finally {
      await f.running.shutdown("test");
    }
  });
});

it("fails closed when the default root is replaced with an outside symlink", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      const outside = path.join(dir, "outside");
      await mkdir(outside);
      await writeFile(path.join(outside, "secret.txt"), "outside-marker");
      await rename(session.workspacePath, `${session.workspacePath}-old`);
      await symlink(outside, session.workspacePath);
      const result = await f.running.app.inject({
        url: "/api/files?workspace=default&path=secret.txt",
        headers: { cookie: f.cookie, origin: f.origin },
      });
      expect(result.statusCode).toBe(403);
      expect(result.body).not.toContain("outside-marker");
    } finally {
      await f.running.shutdown("test");
    }
  });
});

async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Default workspace test timed out");
}
it("uses shared file locks and authenticated WebSocket notifications for the default workspace", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
    const socket = new WebSocket(`ws://127.0.0.1:${f.port}/ws`, {
      headers: { cookie: f.cookie, origin: f.origin },
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      await writeFile(path.join(session.workspacePath, "locked.txt"), "before");
      await until(() => socket.readyState === WebSocket.OPEN);
      socket.send(
        JSON.stringify({
          type: "subscribe",
          subscriptions: [
            { topic: "file", resourceId: "workspace:default", paths: ["."], after: 0 },
          ],
        }),
      );
      await until(() => messages.some((item) => item.kind === "subscribed"));
      const initial = (
        await f.running.app.inject({ url: "/api/files?workspace=default&path=locked.txt", headers })
      ).json();
      const lock = acquireResourceLock(
        { db: f.running.db },
        {
          resourceType: "project",
          resourceId: "workspace:default",
          rootRealPath: await realpath(session.workspacePath),
          owner: "test",
          executionId: "test",
          ttlMs: 30000,
        },
      );
      if (!lock) throw new Error("Expected lock");
      const save = (scope: unknown) =>
        f.running.app.inject({
          method: "PUT",
          url: "/api/files",
          headers,
          payload: {
            scope,
            path: "locked.txt",
            content: "after",
            expectedVersion: initial.version,
          },
        });
      expect((await save({ sessionId: session.id })).statusCode).toBe(409);
      expect(await readFile(path.join(session.workspacePath, "locked.txt"), "utf8")).toBe("before");
      releaseResourceLock({ db: f.running.db }, { id: lock.id, fencingToken: lock.fencingToken });
      expect((await save({ workspace: "default" })).statusCode).toBe(200);
      await until(() =>
        messages.some(
          (item) => item.type === "file.changed" && item.streamId === "file:workspace:default",
        ),
      );
      expect(messages.some((item) => item.kind === "error")).toBe(false);
    } finally {
      socket.close();
      await f.running.shutdown("test");
    }
  });
});

it("runs approved Agent control and file tools in the default workspace while isolating legacy roots", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      const auth = (
        await f.running.app.inject({ url: "/api/auth/session", headers: { cookie: f.cookie } })
      ).json();
      const terminal = await f.running.terminals.create(auth.clientSessionId, "default-ai", {
        scope: { workspace: "default" },
        riskAcknowledged: true,
      });
      await writeFile(path.join(session.workspacePath, "agent.txt"), "old\n");
      const registry = createFileToolRegistry();
      for (const tool of [
        ...createTerminalControlTools({ db: f.running.db }),
        ...createTerminalTools({ db: f.running.db }),
      ])
        registry.register(tool);
      const step = (id: string, name: string, args: unknown): { chunks: ProviderChunk[] } => ({
        chunks: [
          { type: "tool-call", toolCall: { id, name, args } },
          { type: "finish", finishReason: "tool-calls" },
        ],
      });
      const provider = createFakeProvider([
        step("patch", "apply_patch", {
          path: "agent.txt",
          expectedVersion: createHash("sha256").update("old\n").digest("hex"),
          patch: createPatch("agent.txt", "old\n", "new\n"),
        }),
        step("acquire", "acquire_terminal_control", { terminalId: terminal.id }),
        step("send", "send_terminal_input", {
          terminalId: terminal.id,
          leaseGeneration: 1,
          inputSequence: 1,
          data: "printf 'DEFAULT_AI_%s\\n' ok\r",
        }),
        step("read", "read_terminal_output", { terminalId: terminal.id }),
        {
          chunks: [
            { type: "text-delta", text: "done" },
            { type: "finish", finishReason: "stop" },
          ],
        },
      ]);
      const events: { type: string; payload: unknown }[] = [];
      const runner = new TurnRunner({
        db: f.running.db,
        dataDir: f.running.dataDir,
        registry,
        terminals: f.running.terminals,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
        publish: (event) => {
          if ("type" in event) events.push(event);
        },
        approvalPollMs: 5,
      });
      const turn = createTurn(
        { db: f.running.db },
        { sessionId: session.id, text: "default workspace", clientSessionId: auth.clientSessionId },
      );
      const run = runner.run(turn.turnId);
      let approval: { id: string } | undefined;
      await until(() => {
        approval = f.running.sqlite
          .prepare("SELECT id FROM approvals WHERE status = 'pending'")
          .get() as { id: string } | undefined;
        return !!approval;
      });
      if (!approval) throw new Error("Missing approval");
      decideApproval(
        { db: f.running.db },
        { id: approval.id, decision: "approve", decidedBy: "test" },
      );
      expect((await run).status).toBe("COMPLETED");
      expect(await readFile(path.join(session.workspacePath, "agent.txt"), "utf8")).toBe("new\n");
      expect(JSON.stringify(events)).toContain('"workspace":"default"');
      expect(JSON.stringify(provider.calls[0]?.messages[0])).toContain(terminal.id);
      await until(async () =>
        (await f.running.terminals.output(terminal.id, 0, 100)).chunks.some((chunk) =>
          chunk.data.includes("DEFAULT_AI_ok"),
        ),
      );
      expect((await f.running.terminals.read(terminal.id)).lease).toBeNull();
      const legacy = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      const root = path.join(f.running.dataDir, "sessions", legacy.id, "workspace");
      await mkdir(root, { recursive: true });
      f.running.sqlite
        .prepare("UPDATE sessions SET workspace_path = ? WHERE id = ?")
        .run(root, legacy.id);
      await expect(
        f.running.terminals.readSessionTerminal(terminal.id, legacy.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await f.running.shutdown("test");
    }
  });
});
