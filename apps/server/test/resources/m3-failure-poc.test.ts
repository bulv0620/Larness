import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import { expect, it } from "vitest";
import { type IssuedPreview, PreviewGateway } from "../../scripts/m3-poc/gateway.js";

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function startServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        port: typeof address === "object" && address ? address.port : 0,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function virtualRequest(
  port: number,
  host: string,
  path: string,
  cookie?: string,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { host: `${host}:${port}`, ...(cookie ? { cookie } : {}) },
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

async function grantOf(port: number, issued: IssuedPreview): Promise<string> {
  const response = await virtualRequest(port, issued.host, `/__bootstrap?t=${issued.ticket}`);
  expect(response.status).toBe(303);
  const cookie = response.headers["set-cookie"]?.[0]?.split(";")[0];
  if (!cookie) throw new Error("bootstrap did not issue a grant cookie");
  return cookie;
}

function wsConnect(
  port: number,
  host: string,
  cookie: string,
): Promise<{ status: number; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `GET / HTTP/1.1\r\nHost: ${host}:${port}\r\nCookie: ${cookie}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const line = buffer.split("\r\n")[0] ?? "";
      if (line.startsWith("HTTP/1.1 ")) {
        resolve({ status: Number(line.split(" ")[1]), socket });
      }
    });
    socket.on("error", (error) => reject(error));
  });
}

it("fails closed when the grant store is unavailable and forgets grants on restart", async () => {
  const upstream = await startServer((_req, res) => res.end("project"));
  const failing = new PreviewGateway({
    onGrant: () => {
      throw new Error("store unavailable");
    },
  });
  const failingPort = await failing.listen();
  try {
    const issued = failing.issue({ serviceId: "web", port: upstream.port });
    const response = await virtualRequest(
      failingPort,
      issued.host,
      `/__bootstrap?t=${issued.ticket}`,
    );
    expect(response.status).toBe(503);
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect((await virtualRequest(failingPort, issued.host, "/")).status).toBe(401);
  } finally {
    await failing.close();
  }

  const first = new PreviewGateway();
  const firstPort = await first.listen();
  const issued = first.issue({ serviceId: "web", port: upstream.port });
  const cookie = await grantOf(firstPort, issued);
  expect((await virtualRequest(firstPort, issued.host, "/", cookie)).status).toBe(200);
  await first.close();

  const restarted = new PreviewGateway();
  const restartedPort = await restarted.listen();
  try {
    expect((await virtualRequest(restartedPort, issued.host, "/", cookie)).status).toBe(401);
  } finally {
    await restarted.close();
    await upstream.close();
  }
});

it("returns 502 immediately for a closed upstream and 504 for a hanging one", async () => {
  const closed = new PreviewGateway();
  const closedPort = await closed.listen();
  try {
    const issued = closed.issue({ serviceId: "web", port: 9 });
    const cookie = await grantOf(closedPort, issued);
    const started = Date.now();
    const response = await virtualRequest(closedPort, issued.host, "/", cookie);
    expect(response.status).toBe(502);
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    await closed.close();
  }

  const hanging = await startServer(() => {
    // Accepts the connection and never writes a response.
  });
  const slow = new PreviewGateway({ upstreamIdleMs: 300 });
  const slowPort = await slow.listen();
  try {
    const issued = slow.issue({ serviceId: "web", port: hanging.port });
    const cookie = await grantOf(slowPort, issued);
    const started = Date.now();
    const response = await virtualRequest(slowPort, issued.host, "/", cookie);
    expect(response.status).toBe(504);
    expect(Date.now() - started).toBeLessThan(3000);
  } finally {
    await slow.close();
    await hanging.close();
  }
});

it("rejects HTTP and WebSocket connections beyond the configured limit", async () => {
  const held = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("hold");
  });
  const wsUpstream = createServer((_req, res) => res.end("no"));
  const wsSockets = new Set<Socket>();
  wsUpstream.on("connection", (socket) => {
    wsSockets.add(socket);
    socket.on("close", () => wsSockets.delete(socket));
  });
  wsUpstream.on("upgrade", (_req, socket) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
  });
  await new Promise<void>((resolve) => wsUpstream.listen(0, "127.0.0.1", resolve));
  const wsAddress = wsUpstream.address();
  const wsPort = typeof wsAddress === "object" && wsAddress ? wsAddress.port : 0;

  const gateway = new PreviewGateway({ maxHttp: 1, maxWs: 1 });
  const port = await gateway.listen();
  const httpIssued = gateway.issue({ serviceId: "web", port: held.port });
  const wsIssued = gateway.issue({ serviceId: "ws", port: wsPort });
  try {
    const httpCookie = await grantOf(port, httpIssued);
    const first = request({
      host: "127.0.0.1",
      port,
      path: "/",
      headers: { host: `${httpIssued.host}:${port}`, cookie: httpCookie },
    });
    first.end();
    await new Promise<void>((resolve, reject) => {
      first.on("error", reject);
      first.on("response", () => resolve());
    });
    expect((await virtualRequest(port, httpIssued.host, "/", httpCookie)).status).toBe(429);
    first.destroy();

    const wsCookie = await grantOf(port, wsIssued);
    const open = await wsConnect(port, wsIssued.host, wsCookie);
    expect(open.status).toBe(101);
    const rejected = await wsConnect(port, wsIssued.host, wsCookie);
    expect(rejected.status).toBe(429);
    rejected.socket.destroy();
    open.socket.destroy();
  } finally {
    await gateway.close();
    await held.close();
    for (const socket of wsSockets) socket.destroy();
    wsUpstream.closeAllConnections();
    await new Promise<void>((resolve) => wsUpstream.close(() => resolve()));
  }
}, 20_000);

it("rejects an oversized request body instead of forwarding it", async () => {
  let upstreamBytes = 0;
  const upstream = await startServer((req, res) => {
    req.on("data", (chunk: Buffer) => {
      upstreamBytes += chunk.length;
    });
    req.on("end", () => res.end("ok"));
  });
  const gateway = new PreviewGateway({ maxBodyBytes: 1024 });
  const port = await gateway.listen();
  try {
    const issued = gateway.issue({ serviceId: "web", port: upstream.port });
    const cookie = await grantOf(port, issued);
    const response = await new Promise<RawResponse>((resolve, reject) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path: "/",
          method: "POST",
          headers: { host: `${issued.host}:${port}`, cookie, "content-type": "text/plain" },
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
      req.end(Buffer.alloc(4096, "a"));
    });
    expect(response.status).toBe(413);
    expect(upstreamBytes).toBe(0);
  } finally {
    await gateway.close();
    await upstream.close();
  }
}, 20_000);

it("keeps serving a small request while another client stops reading a large stream", async () => {
  const upstream = await startServer((req, res) => {
    if (req.url === "/big") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const timer = setInterval(() => res.write(Buffer.alloc(64 * 1024)), 5);
      res.on("close", () => clearInterval(timer));
      return;
    }
    res.end("small-ok");
  });
  const gateway = new PreviewGateway();
  const port = await gateway.listen();
  try {
    const big = gateway.issue({ serviceId: "big", port: upstream.port });
    const small = gateway.issue({ serviceId: "small", port: upstream.port });
    const bigCookie = await grantOf(port, big);
    const smallCookie = await grantOf(port, small);
    const slow = request({
      host: "127.0.0.1",
      port,
      path: "/big",
      headers: { host: `${big.host}:${port}`, cookie: bigCookie },
    });
    slow.end();
    await new Promise<void>((resolve) => {
      slow.on("response", (response) => {
        response.pause();
        resolve();
      });
    });
    const started = Date.now();
    const fast = await virtualRequest(port, small.host, "/", smallCookie);
    expect(fast.status).toBe(200);
    expect(fast.body).toBe("small-ok");
    expect(Date.now() - started).toBeLessThan(2000);
    slow.destroy();
  } finally {
    await gateway.close();
    await upstream.close();
  }
}, 20_000);
