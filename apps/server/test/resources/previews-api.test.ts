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
import { testConfig, withTempDir, writeConfig } from "../helpers.js";
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

async function fixture(dir: string, previewPort: number) {
  const dataDir = path.join(dir, "data");
  await writeConfig(dataDir, { ...testConfig(), preview: { port: previewPort } });
  const f = await startAuthorizedServer(dataDir);
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
    { sessionId: session.id, text: "preview api", clientSessionId: client },
  );
  updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
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
  await waitFor(async () => (await listeningSockets(port)).length > 0, "listener");
  const service = await f.running.services.registerAgent(
    {
      projectId: project.id,
      operationKey: "preview-api:1",
      sourceSessionId: session.id,
      terminalId: terminal.id,
      kind: "temporary",
      name: "web",
      endpoint: { host: "127.0.0.1", port, protocol: "http" },
    },
    client,
  );
  return { f, project, session, client, service, port };
}

it("resolves a preview ticket through the authenticated API with preview enabled by default", async () => {
  await withTempDir(async (dir) => {
    const previewPort = await freePort();
    const data = await fixture(dir, previewPort);
    try {
      const headers = { cookie: data.f.cookie, origin: data.f.origin, "x-csrf-token": data.f.csrf };
      const resolved = await data.f.running.app.inject({
        method: "POST",
        url: "/api/previews/resolve",
        headers,
        payload: { serviceId: data.service.id, path: "/" },
      });
      expect(resolved.statusCode).toBe(200);
      expect(resolved.headers["cache-control"]).toBe("no-store");
      const body = resolved.json() as {
        origin: string;
        bootstrapUrl: string;
        ticket: string;
        expiresAt: number;
      };
      expect(body.origin).toContain(`.preview.localhost:${previewPort}`);
      expect(body.bootstrapUrl).not.toContain(body.ticket);
      expect(body.expiresAt).toBeGreaterThan(Date.now());

      const noCsrf = await data.f.running.app.inject({
        method: "POST",
        url: "/api/previews/resolve",
        headers: { cookie: data.f.cookie, origin: data.f.origin },
        payload: { serviceId: data.service.id },
      });
      expect([401, 403]).toContain(noCsrf.statusCode);

      data.f.running.services.unregister(data.service.id, "TEST");
      const unavailable = await data.f.running.app.inject({
        method: "POST",
        url: "/api/previews/resolve",
        headers,
        payload: { serviceId: data.service.id },
      });
      expect(unavailable.statusCode).toBe(503);
    } finally {
      await stopAuthorizedServer(data.f);
    }
  });
}, 40_000);

it("returns PREVIEW_DISABLED when preview is disabled", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(path.join(dir, "data"), { preview: { enabled: false } });
    try {
      const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
      const response = await f.running.app.inject({
        method: "POST",
        url: "/api/previews/resolve",
        headers,
        payload: { serviceId: "svc_00000000-0000-0000-0000-000000000000" },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: "PREVIEW_DISABLED" } });
    } finally {
      await stopAuthorizedServer(f);
    }
  });
}, 40_000);
