import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { newId } from "../../src/db/ids.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listeningSockets } from "../../src/modules/services/identity.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { getFreePort, withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

it("streams committed service status events to an authorized subscription", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    const socket = new WebSocket(`ws://127.0.0.1:${f.port}/ws`, {
      headers: { cookie: f.cookie, origin: f.origin },
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
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
        { sessionId: session.id, text: "service ws", clientSessionId: client },
      );
      updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
      const port = await getFreePort();
      const serverPath = path.join(root, "server.mjs");
      await writeFile(
        serverPath,
        [
          'import { createServer } from "node:http";',
          `createServer((request, response) => response.end("ok")).listen(${port}, "127.0.0.1");`,
          "",
        ].join("\n"),
      );
      const terminal = await f.running.terminals.createDev(
        {
          clientSessionId: client,
          projectId: project.id,
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: newId("tool"),
          policySnapshotId: "approved",
          assertAuthorized: () => {},
        },
        { role: "frontend", executable: process.execPath, args: [serverPath] },
      );
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && (await listeningSockets(port)).length === 0) await delay(50);
      expect((await listeningSockets(port)).length).toBeGreaterThan(0);
      const service = await f.running.services.registerAgent(
        {
          projectId: project.id,
          operationKey: "ws:turn:1",
          sourceSessionId: session.id,
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );

      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.send(
        JSON.stringify({
          type: "subscribe",
          subscriptions: [{ topic: "service", resourceId: service.id, after: 0 }],
        }),
      );
      await waitFor(
        () => messages.some((message) => message.kind === "subscribed"),
        "service subscription ack",
      );
      f.running.services.unregister(service.id, "TEST_UNREGISTER");
      await waitFor(
        () =>
          messages.some(
            (message) => message.type === "service.unregistered" && message.streamId === service.id,
          ),
        "service unregistered event",
      );
      const event = messages.find((message) => message.type === "service.unregistered");
      expect(event).toMatchObject({
        topic: "service",
        streamId: service.id,
        payload: { status: "UNREGISTERED", terminalId: terminal.id },
      });
    } finally {
      socket.terminate();
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);
