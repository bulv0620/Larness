import { randomBytes, randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

export interface PreviewService {
  serviceId: string;
  port: number;
}

export interface IssuedPreview {
  host: string;
  ticket: string;
  url: string;
}

export interface GrantSnapshot {
  id: string;
  host: string;
  serviceId: string;
  expiresAt: number;
}

export interface PreviewGatewayOptions {
  now?: () => number;
  ticketTtlMs?: number;
  grantTtlMs?: number;
  maxHttp?: number;
  maxWs?: number;
  maxBodyBytes?: number;
  upstreamIdleMs?: number;
  onGrant?: (grant: GrantSnapshot) => void;
}

interface TicketRecord {
  host: string;
  serviceId: string;
  port: number;
  expiresAt: number;
}

interface GrantRecord {
  id: string;
  host: string;
  serviceId: string;
  port: number;
  expiresAt: number;
}

const GRANT_COOKIE = "poc_preview";

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function projectCookieHeader(header: string | undefined): string | undefined {
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith(`${GRANT_COOKIE}=`));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

function rewriteSetCookie(value: string): string {
  const parts = value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^domain=/i.test(part));
  if (!parts.some((part) => /^path=/i.test(part))) parts.push("Path=/");
  return parts.join("; ");
}

function upstreamHeaders(headers: IncomingHttpHeaders, port: number): OutgoingHttpHeaders {
  const copy: OutgoingHttpHeaders = { ...headers };
  for (const name of [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "te",
    "trailer",
    "proxy-authorization",
    "proxy-connection",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) {
    delete copy[name];
  }
  delete copy.cookie;
  const project = projectCookieHeader(headers.cookie);
  if (project) copy.cookie = project;
  copy.host = `127.0.0.1:${port}`;
  return copy;
}

function upgradeHeaders(headers: IncomingHttpHeaders, port: number): OutgoingHttpHeaders {
  const copy: OutgoingHttpHeaders = { ...headers };
  for (const name of [
    "host",
    "proxy-connection",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
  ]) {
    delete copy[name];
  }
  delete copy.cookie;
  const project = projectCookieHeader(headers.cookie);
  if (project) copy.cookie = project;
  copy.host = `127.0.0.1:${port}`;
  return copy;
}

function responseHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const copy: OutgoingHttpHeaders = { ...headers };
  delete copy.connection;
  delete copy["keep-alive"];
  delete copy["transfer-encoding"];
  delete copy.upgrade;
  if (copy["set-cookie"]) {
    const cookies = Array.isArray(copy["set-cookie"]) ? copy["set-cookie"] : [copy["set-cookie"]];
    copy["set-cookie"] = cookies.map(rewriteSetCookie);
  }
  return copy;
}

export class PreviewGateway {
  readonly #server: Server;
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #grants = new Map<string, GrantRecord>();
  readonly #now: () => number;
  readonly #ticketTtlMs: number;
  readonly #grantTtlMs: number;
  readonly #maxHttp: number;
  readonly #maxWs: number;
  readonly #maxBodyBytes: number;
  readonly #upstreamIdleMs: number;
  readonly #onGrant: ((grant: GrantSnapshot) => void) | undefined;
  readonly #sockets = new Set<Socket>();
  #httpActive = 0;
  #wsActive = 0;
  #port = 0;

  constructor(options: PreviewGatewayOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#ticketTtlMs = options.ticketTtlMs ?? 30_000;
    this.#grantTtlMs = options.grantTtlMs ?? 15 * 60_000;
    this.#maxHttp = options.maxHttp ?? 32;
    this.#maxWs = options.maxWs ?? 8;
    this.#maxBodyBytes = options.maxBodyBytes ?? 16 * 1024 * 1024;
    this.#upstreamIdleMs = options.upstreamIdleMs ?? 10_000;
    this.#onGrant = options.onGrant;
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
        res.end("bad gateway");
      });
    });
    this.#server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    this.#server.on("upgrade", (req, socket, head) => this.#upgrade(req, socket, head));
  }

  async listen(): Promise<number> {
    await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    this.#port = typeof address === "object" && address ? address.port : 0;
    return this.#port;
  }

  close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    return new Promise((resolve) => this.#server.close(() => resolve()));
  }

  issue(service: PreviewService): IssuedPreview {
    const host = `${randomBytes(6).toString("hex")}.preview.localhost`;
    const ticket = randomBytes(24).toString("base64url");
    this.#tickets.set(ticket, {
      host,
      serviceId: service.serviceId,
      port: service.port,
      expiresAt: this.#now() + this.#ticketTtlMs,
    });
    return { host, ticket, url: `http://${host}:${this.#port}/__bootstrap?t=${ticket}` };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostHeader = req.headers.host ?? "";
    const host = hostHeader.split(":")[0];
    if (!host.endsWith(".preview.localhost") || host === "preview.localhost") {
      res.writeHead(421, { "cache-control": "no-store" });
      res.end("misdirected request");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${hostHeader}`);
    if (url.pathname === "/__bootstrap") {
      this.#bootstrap(host, url, res);
      return;
    }
    const grant = this.#authorize(host, req.headers.cookie);
    if (!grant) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("preview unauthorized");
      return;
    }
    if (this.#httpActive >= this.#maxHttp) {
      res.writeHead(429, { "cache-control": "no-store" });
      res.end("preview connection limit");
      return;
    }
    this.#httpActive++;
    res.on("close", () => {
      this.#httpActive--;
    });
    this.#proxy(req, res, url, grant);
  }

  #authorize(host: string, cookie: string | undefined): GrantRecord | undefined {
    const id = cookieValue(cookie, GRANT_COOKIE);
    const grant = id ? this.#grants.get(id) : undefined;
    if (!grant || grant.host !== host) return undefined;
    if (grant.expiresAt <= this.#now()) {
      this.#grants.delete(grant.id);
      return undefined;
    }
    return grant;
  }

  #bootstrap(host: string, url: URL, res: ServerResponse): void {
    const ticket = url.searchParams.get("t") ?? "";
    const record = this.#tickets.get(ticket);
    if (!record || record.host !== host || record.expiresAt <= this.#now()) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("invalid ticket");
      return;
    }
    this.#tickets.delete(ticket);
    const id = randomUUID();
    const grant: GrantRecord = {
      id,
      host,
      serviceId: record.serviceId,
      port: record.port,
      expiresAt: this.#now() + this.#grantTtlMs,
    };
    try {
      this.#onGrant?.(grant);
    } catch {
      res.writeHead(503, { "cache-control": "no-store" });
      res.end("preview grant store unavailable");
      return;
    }
    this.#grants.set(id, grant);
    res.writeHead(303, {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": `${GRANT_COOKIE}=${id}; Path=/; HttpOnly; SameSite=None; Secure`,
    });
    res.end();
  }

  #upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const host = (req.headers.host ?? "").split(":")[0];
    if (!host.endsWith(".preview.localhost")) {
      socket.destroy();
      return;
    }
    const grant = this.#authorize(host, req.headers.cookie);
    if (!grant) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    if (this.#wsActive >= this.#maxWs) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      return;
    }
    this.#wsActive++;
    socket.on("close", () => {
      this.#wsActive--;
    });
    const upstream = connect(grant.port, "127.0.0.1");
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("connect", () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (const [name, value] of Object.entries(upgradeHeaders(req.headers, grant.port))) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  }

  #proxy(req: IncomingMessage, res: ServerResponse, url: URL, grant: GrantRecord): void {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > this.#maxBodyBytes) {
      res.writeHead(413, { "cache-control": "no-store" });
      res.end("preview payload too large");
      req.resume();
      return;
    }
    let received = 0;
    let rejected = false;
    const reject = () => {
      if (rejected) return;
      rejected = true;
      req.unpipe(upstream);
      upstream.destroy();
      if (!res.headersSent) res.writeHead(413, { "cache-control": "no-store" });
      res.end("preview payload too large");
    };
    const upstream = request(
      {
        host: "127.0.0.1",
        port: grant.port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: upstreamHeaders(req.headers, grant.port),
      },
      (upstreamResponse) => {
        res.writeHead(
          upstreamResponse.statusCode ?? 502,
          responseHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(res);
      },
    );
    upstream.setTimeout(this.#upstreamIdleMs, () => {
      if (!res.headersSent) res.writeHead(504, { "cache-control": "no-store" });
      res.end("preview upstream timeout");
      upstream.destroy();
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
      res.end("preview upstream unavailable");
    });
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > this.#maxBodyBytes) reject();
    });
    req.pipe(upstream);
  }
}
