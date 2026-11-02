import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import websocket from "@fastify/websocket";
import { chromium } from "@playwright/test";
import Fastify from "fastify";
import { expect, it, vi } from "vitest";
import { startManagedVite } from "../../../web/scripts/vite-runtime.js";
import { registerDevWeb } from "../../src/dev-web/routes.js";
import { registerErrorHandler } from "../../src/errors.js";
import { emitSessionRevoked } from "../../src/security/session-events.js";
import { getFreePort, testConfig, withTempDir } from "../helpers.js";

it("loads a real Vite React page under nonce CSP and hot-updates over the authenticated public address", async () => {
  await withTempDir(async (root) => {
    const webRoot = fileURLToPath(new URL("../../../web/", import.meta.url));
    await symlink(path.join(webRoot, "node_modules"), path.join(root, "node_modules"));
    await writeFile(
      path.join(root, "package.json"),
      await readFile(path.join(webRoot, "package.json")),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "index.html"),
      '<html><head><script>window.themeReady=true</script></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
    );
    await writeFile(
      path.join(root, "src/main.tsx"),
      'import React from "react";import {createRoot} from "react-dom/client";import {App} from "./App";createRoot(document.getElementById("root")).render(<App/>);',
    );
    const component = path.join(root, "src/App.tsx");
    await writeFile(component, "export function App(){return <h1>Before update</h1>}");
    const port = await getFreePort();
    const origin = `http://localhost:${port}`;
    const vite = await startManagedVite(origin, root);
    const parallel = await startManagedVite(origin, root);
    try {
      expect(parallel.port).not.toBe(vite.port);
    } finally {
      await parallel.server.close();
    }
    const app = Fastify();
    registerErrorHandler(app);
    app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
    let authorized = true;
    registerDevWeb(app, {
      target: { generation: randomUUID(), host: "127.0.0.1", port: vite.port },
      webRoot: root,
      roots: vite.roots,
      config: testConfig(),
      origin,
      resolveSession: (request) =>
        authorized && request.headers.cookie?.includes("larness_session=test")
          ? { id: "test", deviceId: null }
          : null,
    });
    const browser = await chromium.launch({ headless: true });
    try {
      await app.listen({ host: "127.0.0.1", port });
      const vendor = await realpath(
        path.join(
          webRoot,
          "node_modules/monaco-editor/esm/vs/languages/features/typescript/lib/typescriptServices.js",
        ),
      );
      const vendorResponse = await fetch(`${origin}/@fs${vendor}`);
      expect(vendorResponse.status).toBe(200);
      const vendorBytes = (await vendorResponse.arrayBuffer()).byteLength;
      expect(vendorBytes).toBeGreaterThan(1024 * 1024);
      expect(vendorBytes).toBeLessThan(32 * 1024 * 1024);
      const context = await browser.newContext();
      const page = await context.newPage();
      const violations: string[] = [];
      const sockets: string[] = [];
      page.on("websocket", (socket) => sockets.push(new URL(socket.url()).origin));
      await page.exposeFunction("reportCsp", (value: string) => violations.push(value));
      await page.addInitScript(
        'document.addEventListener("securitypolicyviolation", event => { window.reportCsp(event.violatedDirective); });',
      );
      await page.goto(origin);
      await vi.waitFor(
        async () => expect(await page.locator("h1").textContent()).toBe("Before update"),
        { timeout: 15000 },
      );
      expect(await page.evaluate<boolean>("Boolean(window.themeReady)")).toBe(true);
      expect(vite.server.ws.clients.size).toBe(0);
      await context.addCookies([{ name: "larness_session", value: "test", url: origin }]);
      await vi.waitFor(() => expect(vite.server.ws.clients.size).toBe(1), { timeout: 10000 });
      await writeFile(component, "export function App(){return <h1>After update</h1>}");
      await vi.waitFor(
        async () => expect(await page.locator("h1").textContent()).toBe("After update"),
        { timeout: 10000 },
      );
      expect(violations).toEqual([]);
      expect(sockets.length).toBeGreaterThan(0);
      expect(sockets.every((value) => value === origin.replace("http:", "ws:"))).toBe(true);
      authorized = false;
      emitSessionRevoked("test", "test");
      await vi.waitFor(() => expect(vite.server.ws.clients.size).toBe(0));
      authorized = true;
      await vi.waitFor(() => expect(vite.server.ws.clients.size).toBe(1), { timeout: 10000 });
      await writeFile(component, "export function App(){return <h1>After reauthentication</h1>}");
      await vi.waitFor(
        async () => expect(await page.locator("h1").textContent()).toBe("After reauthentication"),
        { timeout: 10000 },
      );
      await page.evaluate(
        'const injected = document.createElement("script"); injected.textContent = "window.injected=true"; document.body.append(injected);',
      );
      expect(await page.evaluate<boolean>("Boolean(window.injected)")).toBe(false);
      await vi.waitFor(() => expect(violations).toContain("script-src-elem"));
    } finally {
      await browser.close();
      await app.close();
      await vite.server.close();
    }
  });
}, 45000);
