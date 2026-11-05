import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { PreviewGateway } from "../../scripts/m3-poc/gateway.js";
import { withTempDir } from "../helpers.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Dev server is not listening yet.
    }
    await delay(100);
  }
  throw new Error(`dev server did not start: ${url}`);
}

function mainSource(value: string): string {
  return [
    `export const value = ${JSON.stringify(value)};`,
    'document.querySelector("#app").textContent = value;',
    "if (import.meta.hot) {",
    "  import.meta.hot.accept((next) => {",
    '    document.querySelector("#app").textContent = next.value;',
    "  });",
    "}",
    'fetch("/api/health")',
    "  .then((response) => response.json())",
    "  .then((data) => {",
    '    document.querySelector("#api").textContent = data.backend;',
    "  });",
    "",
  ].join("\n");
}

it.skipIf(process.env.LARNESS_POC_BROWSER !== "1")(
  "serves a real Vite app with HMR and a relative backend API through the preview gateway",
  async () => {
    const repoRoot = path.resolve(process.cwd(), "../..");
    const viteBin = path.join(repoRoot, "apps/web/node_modules/vite/bin/vite.js");
    await access(viteBin);
    await withTempDir(async (dir) => {
      const vitePort = await freePort();
      const apiPort = await freePort();
      await writeFile(
        path.join(dir, "index.html"),
        '<!doctype html><html><head><script>sessionStorage.setItem("poc-loads", String(Number(sessionStorage.getItem("poc-loads") ?? "0") + 1));</script></head><body><div id="app"></div><div id="api"></div><script type="module" src="/main.js"></script></body></html>',
      );
      await writeFile(path.join(dir, "main.js"), mainSource("v1"));
      await writeFile(
        path.join(dir, "vite.config.mjs"),
        `export default { server: { host: "127.0.0.1", port: ${vitePort}, strictPort: true, proxy: { "/api": "http://127.0.0.1:${apiPort}" } } };\n`,
      );

      const api = createHttpServer((_request: IncomingMessage, response: ServerResponse) => {
        response.setHeader("content-type", "application/json");
        response.end('{"backend":"api-ok"}');
      });
      await new Promise<void>((resolve) => api.listen(apiPort, "127.0.0.1", resolve));

      const vite = spawn(
        process.execPath,
        [viteBin, "--config", "vite.config.mjs", "--port", String(vitePort), "--strictPort"],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let viteLog = "";
      vite.stdout.setEncoding("utf8");
      vite.stderr.setEncoding("utf8");
      vite.stdout.on("data", (chunk: string) => {
        viteLog += chunk;
      });
      vite.stderr.on("data", (chunk: string) => {
        viteLog += chunk;
      });

      const gateway = new PreviewGateway();
      await gateway.listen();
      const browser = await chromium.launch();
      const context = await browser.newContext();
      const page = await context.newPage();
      const requests: string[] = [];
      const sockets: string[] = [];
      page.on("request", (request) => requests.push(request.url()));
      page.on("websocket", (socket) => sockets.push(socket.url()));
      try {
        await waitForHttp(`http://127.0.0.1:${vitePort}/`).catch((error: unknown) => {
          throw new Error(`${String(error)}\n${viteLog}`);
        });
        const issued = gateway.issue({ serviceId: "web", port: vitePort });
        await page.goto(issued.url, { timeout: 10_000 });
        await page.waitForSelector("#app", { timeout: 10_000 });
        expect(await page.textContent("#app")).toBe("v1");
        await page.waitForFunction(
          () => document.querySelector("#api")?.textContent === "api-ok",
          undefined,
          { timeout: 10_000 },
        );

        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && sockets.length === 0) await delay(50);
        expect(sockets.length).toBeGreaterThan(0);
        expect(sockets.every((url) => url.includes(issued.host))).toBe(true);

        await writeFile(path.join(dir, "main.js"), mainSource("v2"));
        await page.waitForFunction(
          () => document.querySelector("#app")?.textContent === "v2",
          undefined,
          { timeout: 10_000 },
        );
        const loads = await page.evaluate(() => sessionStorage.getItem("poc-loads"));
        if (loads !== "1") {
          console.log(`VITE LOG:\n${viteLog}`);
          console.log(`REQUESTS:\n${requests.join("\n")}`);
          console.log(`SOCKETS:\n${sockets.join("\n")}`);
        }
        expect(loads).toBe("1");

        const direct = requests.filter((url) => url.includes(`:${vitePort}`));
        expect(direct).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
        await gateway.close();
        await new Promise<void>((resolve) => api.close(() => resolve()));
        vite.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            vite.kill("SIGKILL");
            resolve();
          }, 3000);
          vite.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    });
  },
  60_000,
);
