/// <reference lib="dom" />

import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request,
  type Server,
  type ServerResponse,
} from "node:http";
import { chromium } from "@playwright/test";
import { expect, it } from "vitest";
import { PreviewGateway } from "../../scripts/m3-poc/gateway.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

interface TestServer {
  port: number;
  requests: IncomingHttpHeaders[];
  close: () => Promise<void>;
}

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<TestServer> {
  return new Promise((resolve) => {
    const requests: IncomingHttpHeaders[] = [];
    const server: Server = createServer((req, res) => {
      requests.push(req.headers);
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        requests,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function virtualRequest(
  port: number,
  host: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: `${host}:${port}`, ...headers },
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
    req.end();
  });
}

function grantCookie(response: RawResponse): string {
  const header = response.headers["set-cookie"]?.[0] ?? "";
  const value = header.split(";")[0];
  expect(value).toMatch(/^poc_preview=/);
  return value;
}

it("issues a one-time ticket, accepts only its preview host and expires grants", async () => {
  let now = 1_000_000;
  const gateway = new PreviewGateway({ now: () => now });
  const port = await gateway.listen();
  const project = await startServer((_req, res) => {
    res.setHeader("set-cookie", "app=1; Domain=localhost; Path=/");
    res.end("project");
  });
  try {
    const issued = gateway.issue({ serviceId: "svc", port: project.port });
    const bootstrap = await virtualRequest(
      port,
      issued.host,
      `/__bootstrap?t=${encodeURIComponent(issued.ticket)}`,
    );
    expect(bootstrap.status).toBe(303);
    expect(bootstrap.headers.location).toBe("/");
    expect(bootstrap.headers["cache-control"]).toBe("no-store");
    const cookie = grantCookie(bootstrap);

    const page = await virtualRequest(port, issued.host, "/", { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toBe("project");
    const upstreamCookie = project.requests.at(-1)?.cookie ?? "";
    expect(upstreamCookie).not.toContain("poc_preview");
    const setCookie = page.headers["set-cookie"]?.[0] ?? "";
    expect(setCookie).toContain("app=1");
    expect(setCookie).not.toMatch(/domain=/i);

    const replay = await virtualRequest(
      port,
      issued.host,
      `/__bootstrap?t=${encodeURIComponent(issued.ticket)}`,
    );
    expect(replay.status).toBe(401);
    expect((await virtualRequest(port, issued.host, "/")).status).toBe(401);
    expect((await virtualRequest(port, "other.preview.localhost", "/", { cookie })).status).toBe(
      401,
    );
    expect((await virtualRequest(port, "127.0.0.1", "/", { cookie })).status).toBe(421);

    const expiredTicket = gateway.issue({ serviceId: "svc", port: project.port });
    now += 30_001;
    const expired = await virtualRequest(
      port,
      expiredTicket.host,
      `/__bootstrap?t=${encodeURIComponent(expiredTicket.ticket)}`,
    );
    expect(expired.status).toBe(401);

    const granted = gateway.issue({ serviceId: "svc", port: project.port });
    const fresh = await virtualRequest(
      port,
      granted.host,
      `/__bootstrap?t=${encodeURIComponent(granted.ticket)}`,
    );
    const freshCookie = grantCookie(fresh);
    now += 15 * 60_000 + 1;
    expect((await virtualRequest(port, granted.host, "/", { cookie: freshCookie })).status).toBe(
      401,
    );
  } finally {
    await gateway.close();
    await project.close();
  }
});

it.skipIf(process.env.LARNESS_POC_BROWSER !== "1")(
  "keeps the management cookie and API out of an embedded preview in Chromium",
  async () => {
    const gateway = new PreviewGateway();
    await gateway.listen();
    const project = await startServer((_req, res) => {
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><body><h1 id="project">project-ok</h1><script>window.previewMarker = "ready";</script></body></html>',
      );
    });
    const issued = gateway.issue({ serviceId: "svc", port: project.port });
    const management = await startServer((req, res) => {
      if (req.url === "/secret") {
        res.setHeader("content-type", "application/json");
        res.end('{"secret":true}');
        return;
      }
      res.setHeader("set-cookie", "mgmt_session=secret; Path=/; HttpOnly; SameSite=Lax");
      res.setHeader("content-type", "text/html");
      res.end(`<html><body><iframe id="preview" src="${issued.url}"></iframe></body></html>`);
    });
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`http://localhost:${management.port}/`, { timeout: 5000 });
      await page.waitForSelector("#preview", { timeout: 5000 });
      let frame = page.frames().find((item) => item.url().includes(issued.host));
      for (let round = 0; round < 100 && !frame; round++) {
        await delay(50);
        frame = page.frames().find((item) => item.url().includes(issued.host));
      }
      if (!frame) throw new Error("preview frame did not attach");
      await frame.waitForSelector("#project", { timeout: 5000 });
      expect(
        await frame.evaluate(() => (window as Window & { previewMarker?: string }).previewMarker),
      ).toBe("ready");
      expect(await frame.evaluate(() => document.domain)).toBe(issued.host);
      expect(await frame.evaluate(() => document.cookie)).toBe("");

      const upstreamCookie = project.requests.at(-1)?.cookie ?? "";
      expect(upstreamCookie).not.toContain("poc_preview");
      expect(upstreamCookie).not.toContain("mgmt_session");

      const crossOrigin = await frame.evaluate(
        (origin) =>
          fetch(`${origin}/secret`)
            .then((response) => response.text())
            .then((body) => `ok:${body}`)
            .catch(() => "blocked"),
        `http://localhost:${management.port}`,
      );
      expect(crossOrigin).toBe("blocked");

      await frame.evaluate(() => {
        // biome-ignore lint/suspicious/noDocumentCookie: deliberately attempts cross-host cookie tossing
        document.cookie = "tossed=1; Domain=localhost; Path=/";
      });
      await page.goto(`http://localhost:${management.port}/after`, { timeout: 5000 });
      const managementCookie = management.requests.at(-1)?.cookie ?? "";
      expect(managementCookie).not.toContain("tossed");
    } finally {
      await context.close();
      await browser.close();
      await management.close();
      await project.close();
      await gateway.close();
    }
  },
  30_000,
);
