import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { permittedPath, webRoots } from "../../src/dev-web/paths.js";
import { registerDevWeb } from "../../src/dev-web/routes.js";
import { registerErrorHandler } from "../../src/errors.js";
import { testConfig, withTempDir } from "../helpers.js";

it("forwards only frontend reads, removes credentials and assigns a fresh CSP nonce", async () => {
  await withTempDir(async (root) => {
    let headers: import("node:http").IncomingHttpHeaders = {};
    const upstream = createServer((req, res) => {
      headers = req.headers;
      res.setHeader("content-type", "text/html");
      res.setHeader("set-cookie", "bad=upstream");
      res.end('<script nonce="LARNESS_DEV_RESPONSE_NONCE">window.test=1</script>');
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const app = Fastify();
    registerErrorHandler(app);
    app.register(websocket);
    app.get("/api/health", async () => ({ status: "ok" }));
    registerDevWeb(app, {
      target: { generation: randomUUID(), host: "127.0.0.1", port: address.port },
      webRoot: root,
      roots: [root],
      config: testConfig(),
      origin: "http://localhost:3210",
      resolveSession: () => null,
    });
    try {
      const response = await app.inject({
        url: "/",
        headers: {
          host: "localhost:3210",
          cookie: "private",
          authorization: "private",
          "x-csrf-token": "private",
          "x-forwarded-host": "evil",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(headers.cookie).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers["x-csrf-token"]).toBeUndefined();
      expect(headers["x-forwarded-host"]).toBeUndefined();
      expect(response.headers["set-cookie"]).toBeUndefined();
      const nonce = /nonce="([^"]+)"/.exec(response.body)?.[1];
      expect(nonce).toBeTruthy();
      expect(nonce).not.toBe("LARNESS_DEV_RESPONSE_NONCE");
      expect(response.headers["content-security-policy"]).toContain(`'nonce-${nonce}'`);
      const second = await app.inject({ url: "/", headers: { host: "localhost:3210" } });
      expect(second.body).not.toBe(response.body);
      expect((await app.inject("/api/health")).json()).toEqual({ status: "ok" });
      for (const url of [
        "/api/missing",
        "/ws/missing",
        "/__open-in-editor?file=/tmp/x",
        "/_larness/dev/hmr",
      ])
        expect((await app.inject({ url, headers: { host: "localhost:3210" } })).statusCode).toBe(
          404,
        );
      expect(
        (await app.inject({ url: "/", method: "POST", headers: { host: "localhost:3210" } }))
          .statusCode,
      ).toBe(404);
      expect((await app.inject({ url: "/", headers: { host: "evil.test" } })).statusCode).toBe(403);
      expect(
        (
          await app.inject({
            url: "/",
            headers: { host: "localhost:3210", origin: "https://evil.test" },
          })
        ).statusCode,
      ).toBe(403);
      await mkdir(path.join(root, "src"));
      await writeFile(path.join(root, ".env"), "private");
      const outside = path.join(path.dirname(root), `outside-${randomUUID()}`);
      await symlink(
        path.dirname(root),
        path.join(root, "src/outside"),
        process.platform === "win32" ? "junction" : undefined,
      );
      const fsUrl =
        process.platform === "win32" ? `/@fs/${outside.replaceAll("\\", "/")}` : `/@fs${outside}`;
      for (const url of ["/.env", "/src/outside/missing", "/%252e%252e/secret", fsUrl])
        expect(
          (await app.inject({ url, headers: { host: "localhost:3210" } })).statusCode,
          url,
        ).toBe(404);
    } finally {
      await app.close();
      upstream.closeAllConnections();
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });
});

it("fails closed on redirects, oversized responses and a broken upstream without exposing diagnostics", async () => {
  await withTempDir(async (root) => {
    let mode = "redirect";
    const upstream = createServer((_req, res) => {
      if (mode === "redirect") {
        res.writeHead(302, { location: "http://example.com/private" });
        res.end();
      } else if (mode === "large") {
        res.writeHead(200, { "content-length": 33 * 1024 * 1024 });
        res.end();
      } else if (mode === "broken") res.destroy();
      else {
        res.setHeader("content-type", "text/html");
        res.write('<script nonce="LARNESS_DEV_');
        setImmediate(() => res.end('RESPONSE_NONCE">ok</script>'));
      }
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const address = upstream.address();
    if (!address || typeof address === "string") throw new Error("address");
    const app = Fastify();
    registerErrorHandler(app);
    app.register(websocket);
    registerDevWeb(app, {
      target: { generation: randomUUID(), host: "127.0.0.1", port: address.port },
      webRoot: root,
      roots: [root],
      config: testConfig(),
      origin: "http://localhost:3210",
      resolveSession: () => null,
    });
    try {
      for (const value of ["redirect", "large", "broken"]) {
        mode = value;
        const response = await app.inject({ url: "/", headers: { host: "localhost:3210" } });
        expect(response.statusCode).toBe(503);
        expect(response.json().error.code).toBe("DEV_WEB_UNAVAILABLE");
        expect(
          response.body.includes("example.com") || response.body.includes(String(address.port)),
        ).toBe(false);
      }
      mode = "chunked";
      const response = await app.inject({ url: "/", headers: { host: "localhost:3210" } });
      expect(response.statusCode).toBe(200);
      expect(response.body.includes("LARNESS_DEV_")).toBe(false);
      expect(response.body).toContain(">ok</script>");
    } finally {
      await app.close();
      upstream.closeAllConnections();
      await new Promise<void>((done) => upstream.close(() => done()));
    }
  });
});

it("allows the managed browser to load Material file icon modules and images", () => {
  const webRoot = fileURLToPath(new URL("../../../web", import.meta.url));
  const packageRoot = realpathSync(path.join(webRoot, "node_modules", "material-icon-theme"));
  const roots = webRoots(webRoot);
  for (const asset of ["dist/material-icons.json", "icons/typescript.svg"]) {
    const url = `/@fs/${path.join(packageRoot, asset).replaceAll("\\", "/")}?import`;
    expect(permittedPath(url, webRoot, roots)).toBe(true);
  }
});
