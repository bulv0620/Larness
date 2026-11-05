import { mkdir, writeFile } from "node:fs/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import { connect, createServer } from "node:net";
import path from "node:path";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { newId } from "../../src/db/ids.js";
import { browserSessions } from "../../src/db/schema.js";
import { PreviewRegistry } from "../../src/modules/previews/registry.js";
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

function serverSource(port: number): string {
  return [
    'import { createServer } from "node:http";',
    "const server = createServer((request, response) => response.end(`${request.headers.host}|${request.headers.cookie ?? ''}`));",
    'server.on("upgrade", (request, socket) => {',
    '  socket.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n\\r\\n");',
    '  socket.on("data", (data) => socket.write(`echo:${data}`));',
    "});",
    `server.listen(${port}, "127.0.0.1");`,
    'console.log("READY");',
    "",
  ].join("\n");
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function rawRequest(
  port: number,
  host: string,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/",
        headers: { host: `${host}:${port}`, ...options.headers },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
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
    { sessionId: session.id, text: "preview", clientSessionId: client },
  );
  updateTurnRow(f.running.db, turn.turnId, { status: "RUNNING" });
  const port = await freePort();
  const serverPath = path.join(root, "server.mjs");
  await writeFile(serverPath, serverSource(port));
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
      operationKey: "preview:1",
      sourceSessionId: session.id,
      terminalId: terminal.id,
      kind: "temporary",
      name: "web",
      endpoint: { host: "127.0.0.1", port, protocol: "http" },
    },
    client,
  );
  return { f, project, session, client, service, port, terminal };
}

async function bootstrap(
  registry: PreviewRegistry,
  resolved: { origin: string; bootstrapUrl: string; ticket: string },
): Promise<RawResponse & { grant: string }> {
  const host = new URL(resolved.origin).hostname;
  const response = await rawRequest(registry.port, host, {
    method: "POST",
    path: "/__bootstrap",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `ticket=${encodeURIComponent(resolved.ticket)}`,
  });
  const cookie = response.headers["set-cookie"]?.[0]?.split(";")[0] ?? "";
  return { ...response, grant: cookie };
}

it("resolves a ticket, consumes it once and proxies only the granted preview host", async () => {
  await withTempDir(async (dir) => {
    const data = await fixture(dir);
    const registry = new PreviewRegistry({
      db: data.f.running.db,
      services: data.f.running.services,
      events: data.f.running.resourceEvents,
      port: 0,
      ticketTtlMs: 500,
      grantTtlMs: 2000,
    });
    await registry.start();
    try {
      const resolved = await registry.resolve(
        { serviceId: data.service.id, path: "/", mode: "embedded" },
        data.client,
      );
      expect(resolved.bootstrapUrl).not.toContain(resolved.ticket);
      expect(resolved.origin).toMatch(/^http:\/\/[a-f0-9]{12}\.preview\.localhost:\d+$/);
      const host = new URL(resolved.origin).hostname;

      const opened = await bootstrap(registry, resolved);
      expect(opened.status).toBe(303);
      expect(opened.headers.location).toBe("/");
      expect(opened.grant).toMatch(/^larness_preview=/);
      const cookie = opened.grant;

      const proxied = await rawRequest(registry.port, host, { headers: { cookie } });
      expect(proxied.status).toBe(200);
      expect(proxied.body).toContain(`127.0.0.1:${data.port}`);
      expect(proxied.body).not.toContain("larness_preview");
      expect((await rawRequest(registry.port, host, {})).status).toBe(401);
      expect((await rawRequest(registry.port, "127.0.0.1", { headers: { cookie } })).status).toBe(
        421,
      );
      expect((await bootstrap(registry, resolved)).status).toBe(401);
      expect(
        (await rawRequest(registry.port, host, { headers: { cookie: "larness_preview=bad" } }))
          .status,
      ).toBe(401);

      data.f.running.services.unregister(data.service.id, "TEST_UNREGISTER");
      expect((await rawRequest(registry.port, host, { headers: { cookie } })).status).toBe(401);
    } finally {
      await registry.stop();
      await stopAuthorizedServer(data.f);
    }
  });
}, 40_000);

it("proxies WebSocket upgrades for a granted preview and rejects missing grants", async () => {
  await withTempDir(async (dir) => {
    const data = await fixture(dir);
    const registry = new PreviewRegistry({
      db: data.f.running.db,
      services: data.f.running.services,
      events: data.f.running.resourceEvents,
      port: 0,
    });
    await registry.start();
    try {
      const resolved = await registry.resolve({ serviceId: data.service.id }, data.client);
      const host = new URL(resolved.origin).hostname;
      const opened = await bootstrap(registry, resolved);
      const socket = connect(registry.port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      let text = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        text += chunk;
      });
      socket.write(
        `GET / HTTP/1.1\r\nHost: ${host}:${registry.port}\r\nCookie: ${opened.grant}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      await waitFor(async () => text.includes("101 Switching Protocols"), "websocket upgrade");
      socket.write("hi");
      await waitFor(async () => text.includes("echo:hi"), "websocket echo");

      const denied = connect(registry.port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        denied.once("connect", resolve);
        denied.once("error", reject);
      });
      let deniedText = "";
      denied.setEncoding("utf8");
      denied.on("data", (chunk: string) => {
        deniedText += chunk;
      });
      denied.write(
        `GET / HTTP/1.1\r\nHost: ${host}:${registry.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      await waitFor(async () => deniedText.includes("401"), "unauthorized upgrade");
      socket.destroy();
      denied.destroy();
    } finally {
      await registry.stop();
      await stopAuthorizedServer(data.f);
    }
  });
}, 40_000);

it("enforces ticket and grant expiry, session revocation and safe paths", async () => {
  await withTempDir(async (dir) => {
    const data = await fixture(dir);
    const registry = new PreviewRegistry({
      db: data.f.running.db,
      services: data.f.running.services,
      events: data.f.running.resourceEvents,
      port: 0,
      ticketTtlMs: 80,
      grantTtlMs: 120,
    });
    await registry.start();
    try {
      const expiredTicket = await registry.resolve({ serviceId: data.service.id }, data.client);
      await delay(120);
      expect((await bootstrap(registry, expiredTicket)).status).toBe(401);

      const granted = await registry.resolve({ serviceId: data.service.id }, data.client);
      const opened = await bootstrap(registry, granted);
      const host = new URL(granted.origin).hostname;
      expect(
        (await rawRequest(registry.port, host, { headers: { cookie: opened.grant } })).status,
      ).toBe(200);
      await delay(180);
      expect(
        (await rawRequest(registry.port, host, { headers: { cookie: opened.grant } })).status,
      ).toBe(401);

      const revoked = await registry.resolve({ serviceId: data.service.id }, data.client);
      const revokedOpen = await bootstrap(registry, revoked);
      data.f.running.db
        .update(browserSessions)
        .set({ revokedAt: Date.now() })
        .where(eq(browserSessions.id, data.client))
        .run();
      expect(
        (await rawRequest(registry.port, host, { headers: { cookie: revokedOpen.grant } })).status,
      ).toBe(401);

      await expect(
        registry.resolve({ serviceId: data.service.id, path: "//evil.example" }, data.client),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
      await expect(
        registry.resolve({ serviceId: data.service.id, path: "http://evil.example/" }, data.client),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    } finally {
      await registry.stop();
      await stopAuthorizedServer(data.f);
    }
  });
}, 40_000);
