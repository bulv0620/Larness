import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { newId } from "../../src/db/ids.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listeningSockets } from "../../src/modules/services/identity.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";
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

it("invalidates temporary registrations when the server restarts", async () => {
  await withTempDir(async (dir) => {
    const dataDir = path.join(dir, "data");
    const first = await startAuthorizedServer(dataDir);
    const root = path.join(dir, "project");
    await mkdir(root);
    let serviceId = "";
    try {
      const project = await createProject({ db: first.running.db }, { rootPath: root });
      const session = await createSession(
        { db: first.running.db, dataDir: first.running.dataDir },
        { projectId: project.id },
      );
      const client = (
        await first.running.app.inject({
          url: "/api/auth/session",
          headers: { cookie: first.cookie },
        })
      ).json().clientSessionId as string;
      const turn = createTurn(
        { db: first.running.db },
        { sessionId: session.id, text: "restart", clientSessionId: client },
      );
      updateTurnRow(first.running.db, turn.turnId, { status: "RUNNING" });
      const port = await freePort();
      const serverPath = path.join(root, "server.mjs");
      await writeFile(
        serverPath,
        [
          'import { createServer } from "node:http";',
          `createServer((request, response) => response.end("ok")).listen(${port}, "127.0.0.1");`,
          "",
        ].join("\n"),
      );
      const terminal = await first.running.terminals.createDev(
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
      await waitFor(async () => (await listeningSockets(port)).length > 0, "listener");
      const service = await first.running.services.registerAgent(
        {
          projectId: project.id,
          operationKey: "restart:1",
          sourceSessionId: session.id,
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );
      serviceId = service.id;
      expect(first.running.services.get(serviceId).status).toBe("RUNNING");
    } finally {
      await stopAuthorizedServer(first);
    }
    const port = await getFreePort();
    const running = await startServer({
      env: { LARNESS_DATA_DIR: dataDir, LARNESS_PORT: String(port) },
      logDestination: createLogSink().stream,
      turnRunner: false,
    });
    try {
      const recovered = running.services.get(serviceId);
      expect(recovered.status).toBe("UNREGISTERED");
      expect([
        "SERVER_RESTART",
        "TERMINAL_IDENTITY_CHANGED",
        "TERMINAL_ENDED",
        "LISTENER_GONE",
      ]).toContain(recovered.reasonCode);
    } finally {
      await running.shutdown("test");
    }
  });
}, 40_000);
