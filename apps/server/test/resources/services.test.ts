import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { decideToolAccess } from "@larness/agent";
import { expect, it } from "vitest";
import { newId } from "../../src/db/ids.js";
import { resourceActions } from "../../src/db/schema.js";
import { createServiceTools } from "../../src/modules/agent/serviceTool.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listResourceEvents, ResourceEventBus } from "../../src/modules/resources/events.js";
import {
  findOperation,
  insertOperation,
  resourceSequence,
} from "../../src/modules/resources/repository.js";
import { listeningSockets } from "../../src/modules/services/identity.js";
import { ServiceManager } from "../../src/modules/services/manager.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function serverSource(port: number, host = "127.0.0.1"): string {
  return [
    'import { createServer } from "node:http";',
    `createServer((request, response) => response.end("ok")).listen(${port}, ${JSON.stringify(host)}, () => console.log("READY"));`,
    "",
  ].join("\n");
}

async function fixture(dir: string) {
  const f = await startAuthorizedServer(path.join(dir, "data"));
  const root = path.join(dir, "project");
  await mkdir(root);
  const project = await createProject({ db: f.running.db }, { rootPath: root });
  const session = await createSession(
    { db: f.running.db, dataDir: f.running.dataDir },
    { projectId: project.id },
  );
  const client = (
    await f.running.app.inject({ url: "/api/auth/session", headers: { cookie: f.cookie } })
  ).json().clientSessionId as string;
  const turn = createTurn(
    { db: f.running.db },
    { sessionId: session.id, text: "service", clientSessionId: client },
  );
  updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
  const manager = f.running.terminals;
  const services = new ServiceManager({
    db: f.running.db,
    events: new ResourceEventBus(),
  });
  const context = {
    clientSessionId: client,
    projectId: project.id,
    sessionId: session.id,
    turnId: turn.turnId,
    toolCallId: newId("tool"),
    policySnapshotId: "approved",
    assertAuthorized: () => {},
  };
  const operation = () => {
    const id = newId("rop");
    insertOperation(f.running.db, {
      id,
      scopeKey: `project:${project.id}`,
      rootRealPath: root,
      kind: "service.register",
      status: "PREPARED",
      paramsHash: "hash",
      idempotencyKey: newId("key"),
      clientSessionId: client,
      path: "",
      expectedVersion: "",
      targetVersion: "",
      lockId: "",
      fencingToken: 0,
      resultJson: null,
      errorCode: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  };
  const input = async (terminalId: string) => {
    const connection = randomUUID();
    manager.connect(client, connection, () => true);
    manager.subscribe(terminalId, connection);
    const lease = await manager.lease(terminalId, client, {
      action: "acquire",
      connectionId: connection,
    });
    const generation = lease.lease?.generation;
    if (!generation) throw new Error("Missing input lease");
    let sequence = 0;
    return (data: string) =>
      manager.input(terminalId, client, connection, generation, ++sequence, data);
  };
  return {
    f,
    root,
    project,
    session,
    client,
    context,
    manager,
    services,
    operation,
    input,
  };
}

it("registers a verified temporary service, replays events and unregisters when the listener exits", async () => {
  await withTempDir(async (dir) => {
    const fixtureData = await fixture(dir);
    const { f, root, project, client, context, manager, services, operation } = fixtureData;
    try {
      const port = await freePort();
      const serverPath = path.join(root, "server.mjs");
      await writeFile(serverPath, serverSource(port));
      const terminal = await manager.createDev(context, {
        role: "frontend",
        executable: process.execPath,
        args: [serverPath, String(port)],
      });
      await waitFor(async () => (await listeningSockets(port)).length > 0, "listener");

      const registered = await services.register(
        {
          projectId: project.id,
          operationId: operation(),
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );
      expect(registered.status).toBe("RUNNING");
      expect(registered.previewEligible).toBe(true);
      expect(registered.endpoint).toEqual({ host: "127.0.0.1", port, protocol: "http" });
      expect(registered.terminalExecutionId).toMatch(/^exe_/);
      expect(resourceSequence(f.running.db, registered.id)).toBe(1);

      const listed = services.list({ projectId: project.id, limit: 50 });
      expect(listed.items.map((item) => item.id)).toContain(registered.id);
      expect(listed.nextCursor).toBeNull();

      const replay = await listResourceEvents(
        { db: f.running.db, dataDir: f.running.dataDir },
        { streamId: registered.id, after: 0, limit: 10 },
      );
      expect(replay.items[0]).toMatchObject({
        topic: "service",
        type: "service.registered",
        streamId: registered.id,
      });
      expect(replay.items[0]?.payload).toMatchObject({
        status: "RUNNING",
        terminalId: terminal.id,
      });

      const again = await services.register(
        {
          projectId: project.id,
          operationId: operation(),
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );
      expect(again.id).toBe(registered.id);
      await expect(
        services.register(
          {
            projectId: project.id,
            operationId: operation(),
            terminalId: terminal.id,
            kind: "temporary",
            name: "other",
            endpoint: { host: "127.0.0.1", port, protocol: "http" },
          },
          client,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const write = await fixtureData.input(terminal.id);
      await write("\u0003");
      await waitFor(async () => (await listeningSockets(port)).length === 0, "listener exit");
      await services.reconcile();
      const ended = services.get(registered.id);
      expect(ended.status).toBe("UNREGISTERED");
      expect(ended.previewEligible).toBe(false);
      expect(ended.reasonCode).toBe("LISTENER_GONE");
      expect(resourceSequence(f.running.db, registered.id)).toBe(2);
      const endedReplay = await listResourceEvents(
        { db: f.running.db, dataDir: f.running.dataDir },
        { streamId: registered.id, after: 0, limit: 10 },
      );
      expect(endedReplay.items.at(-1)).toMatchObject({ type: "service.unregistered" });

      await delay(200);
      await write(`"${process.execPath}" "${serverPath}" ${port}\n`);
      await waitFor(async () => (await listeningSockets(port)).length > 0, "restarted listener");
      const restarted = await services.register(
        {
          projectId: project.id,
          operationId: operation(),
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );
      expect(restarted.id).not.toBe(registered.id);
      expect(restarted.terminalExecutionId).not.toBe(registered.terminalExecutionId);
      expect(services.get(registered.id).status).toBe("UNREGISTERED");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);

it("rejects listeners outside the terminal tree, wildcard listeners and missing endpoints", async () => {
  await withTempDir(async (dir) => {
    const fixtureData = await fixture(dir);
    const { f, root, project, client, context, manager, services, operation } = fixtureData;
    let external: ChildProcess | undefined;
    try {
      const port = await freePort();
      external = spawn(
        process.execPath,
        [
          "-e",
          `require("node:http").createServer((request, response) => response.end("x")).listen(${port}, "127.0.0.1")`,
        ],
        { stdio: "ignore" },
      );
      await waitFor(async () => (await listeningSockets(port)).length > 0, "external listener");

      const terminal = await manager.createDev(
        { ...context, toolCallId: newId("tool") },
        {
          role: "backend",
          executable: process.execPath,
          args: ["-e", "setInterval(() => {}, 1000)"],
        },
      );
      await expect(
        services.register(
          {
            projectId: project.id,
            operationId: operation(),
            terminalId: terminal.id,
            kind: "temporary",
            name: "outside",
            endpoint: { host: "127.0.0.1", port, protocol: "http" },
          },
          client,
        ),
      ).rejects.toMatchObject({ code: "PREVIEW_TARGET_INVALID" });

      const wildcardPort = await freePort();
      const wildcardPath = path.join(root, "wildcard.mjs");
      await writeFile(wildcardPath, serverSource(wildcardPort, "0.0.0.0"));
      const wildcardTerminal = await manager.createDev(
        { ...context, toolCallId: newId("tool") },
        {
          role: "frontend",
          executable: process.execPath,
          args: [wildcardPath, String(wildcardPort)],
        },
      );
      await waitFor(
        async () => (await listeningSockets(wildcardPort)).length > 0,
        "wildcard listener",
      );
      await expect(
        services.register(
          {
            projectId: project.id,
            operationId: operation(),
            terminalId: wildcardTerminal.id,
            kind: "temporary",
            name: "wildcard",
            endpoint: { host: "127.0.0.1", port: wildcardPort, protocol: "http" },
          },
          client,
        ),
      ).rejects.toMatchObject({ code: "PREVIEW_TARGET_INVALID" });

      const emptyPort = await freePort();
      await expect(
        services.register(
          {
            projectId: project.id,
            operationId: operation(),
            terminalId: terminal.id,
            kind: "temporary",
            name: "missing",
            endpoint: { host: "127.0.0.1", port: emptyPort, protocol: "http" },
          },
          client,
        ),
      ).rejects.toMatchObject({ code: "PREVIEW_TARGET_INVALID" });
    } finally {
      external?.kill("SIGKILL");
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);

it("registers a verified service for an authorized agent without a second approval", async () => {
  await withTempDir(async (dir) => {
    const fixtureData = await fixture(dir);
    const { f, root, project, session, client, context, manager, services } = fixtureData;
    try {
      const port = await freePort();
      const serverPath = path.join(root, "server.mjs");
      await writeFile(serverPath, serverSource(port));
      const terminal = await manager.createDev(
        { ...context, toolCallId: newId("tool") },
        { role: "frontend", executable: process.execPath, args: [serverPath, String(port)] },
      );
      await waitFor(async () => (await listeningSockets(port)).length > 0, "listener");
      const input = {
        projectId: project.id,
        operationKey: "turn-1:tool-call-1",
        sourceSessionId: session.id,
        terminalId: terminal.id,
        kind: "temporary" as const,
        name: "web",
        endpoint: { host: "127.0.0.1" as const, port, protocol: "http" as const },
      };
      const registered = await services.registerAgent(input, client);
      expect(registered.status).toBe("RUNNING");
      expect(registered.sourceSessionId).toBe(session.id);
      expect(f.running.db.select().from(resourceActions).all()).toHaveLength(0);
      const operation = findOperation(f.running.db, client, input.operationKey, "service.register");
      expect(operation?.status).toBe("COMPLETED");
      const again = await services.registerAgent(input, client);
      expect(again.id).toBe(registered.id);

      const tools = createServiceTools();
      const register = tools.find((tool) => tool.name === "register_temporary_service");
      expect(register?.riskLevel).toBe("L2");
      expect(decideToolAccess("autonomous", "L2")).toBe("allow");
      expect(decideToolAccess("standard", "L2")).toBe("require_approval");
      expect(decideToolAccess("readonly", "L2")).toBe("deny");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);
