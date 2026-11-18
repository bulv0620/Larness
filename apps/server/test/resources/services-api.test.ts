import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { expect, it } from "vitest";
import { newId } from "../../src/db/ids.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listeningSockets } from "../../src/modules/services/identity.js";
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

it("serves historical service records without a registration endpoint", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
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
        { sessionId: session.id, text: "service api", clientSessionId: client },
      );
      updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
      const port = await freePort();
      const serverPath = path.join(root, "server.mjs");
      await writeFile(
        serverPath,
        [
          'import { createServer } from "node:http";',
          `createServer((request, response) => response.end("ok")).listen(${port}, "127.0.0.1", () => console.log("READY"));`,
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
        { role: "frontend", executable: process.execPath, args: [serverPath, String(port)] },
      );
      await waitFor(async () => (await listeningSockets(port)).length > 0, "listener");
      const headers = {
        cookie: f.cookie,
        origin: f.origin,
        "x-csrf-token": f.csrf,
      };

      const removedRoute = await f.running.app.inject({
        method: "POST",
        url: "/api/services",
        headers,
        payload: {
          kind: "temporary",
          terminalId: terminal.id,
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
      });
      expect(removedRoute.statusCode).toBe(404);

      const service = await f.running.services.registerAgent(
        {
          projectId: project.id,
          operationKey: "service-api:1",
          sourceSessionId: session.id,
          terminalId: terminal.id,
          kind: "temporary",
          name: "web",
          endpoint: { host: "127.0.0.1", port, protocol: "http" },
        },
        client,
      );

      const listed = await f.running.app.inject({
        url: `/api/services?projectId=${project.id}`,
        headers,
      });
      expect(listed.statusCode).toBe(200);
      const list = listed.json() as { items: { id: string }[] };
      expect(list.items.map((item) => item.id)).toContain(service.id);

      const detail = await f.running.app.inject({
        url: `/api/services/${service.id}`,
        headers,
      });
      expect(detail.statusCode).toBe(200);
      const dto = detail.json() as { status: string; terminalId: string };
      expect(dto.status).toBe("RUNNING");
      expect(dto.terminalId).toBe(terminal.id);

      const logs = await f.running.app.inject({
        url: `/api/services/${service.id}/logs`,
        headers,
      });
      expect(logs.statusCode).toBe(200);
      expect((logs.json() as { terminalId: string }).terminalId).toBe(terminal.id);

      const removed = await f.running.app.inject({
        method: "DELETE",
        url: `/api/services/${service.id}`,
        headers,
      });
      expect(removed.statusCode).toBe(200);
      expect((removed.json() as { status: string; reasonCode: string }).status).toBe(
        "UNREGISTERED",
      );
      expect((removed.json() as { reasonCode: string }).reasonCode).toBe("DELETED");

      const stopAgain = await f.running.app.inject({
        method: "POST",
        url: `/api/services/${service.id}/stop`,
        headers,
      });
      expect(stopAgain.statusCode).toBe(200);
      expect((stopAgain.json() as { status: string }).status).toBe("UNREGISTERED");
    } finally {
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);
