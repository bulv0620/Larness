import { createHash, randomBytes } from "node:crypto";
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
import { parse as parseQuery } from "node:querystring";
import type { Duplex } from "node:stream";
import { FileManagerError } from "@larness/resources";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { browserSessions } from "../../db/schema.js";
import type { ResourceEventBus } from "../resources/events.js";
import type { ServiceManager } from "../services/manager.js";

export interface PreviewResolveInput {
  serviceId: string;
  path?: string;
  mode?: "embedded" | "external";
}

export interface ResolvedPreview {
  origin: string;
  bootstrapUrl: string;
  ticket: string;
  expiresAt: number;
  mode: "embedded" | "external";
}

export interface PreviewRegistryOptions {
  db: Database;
  services: ServiceManager;
  events?: ResourceEventBus;
  port?: number;
  hostSuffix?: string;
  idleTtlMinutes?: number;
  now?: () => number;
  ticketTtlMs?: number;
  grantTtlMs?: number;
  maxConnections?: number;
  maxBodyBytes?: number;
}

interface TicketRecord {
  hash: string;
  host: string;
  serviceId: string;
  path: string;
  mode: "embedded" | "external";
  clientSessionId: string;
  expiresAt: number;
}

interface GrantRecord {
  hash: string;
  host: string;
  serviceId: string;
  clientSessionId: string;
  expiresAt: number;
  sockets: Set<Socket>;
}

const GRANT_COOKIE = "larness_preview";
const BOOTSTRAP_PATH = "/__bootstrap";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safePath(value: string | undefined): string {
  const target = value ?? "/";
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    target.includes("\u0000") ||
    target.includes("://")
  ) {
    throw new FileManagerError("VALIDATION_ERROR", "Invalid preview path");
  }
  return target;
}

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

export class PreviewRegistry {
  readonly #db: Database;
  readonly #services: ServiceManager;
  readonly #events: ResourceEventBus | undefined;
  readonly #hostSuffix: string;
  readonly #idleTtlMinutes: number;
  readonly #now: () => number;
  readonly #ticketTtlMs: number;
  readonly #grantTtlMs: number;
  readonly #maxConnections: number;
  readonly #maxBodyBytes: number;
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #grants = new Map<string, GrantRecord>();
  readonly #verifyCache = new Map<string, { at: number; ok: boolean }>();
  readonly #sockets = new Set<Socket>();
  readonly #server: Server;
  readonly #configuredPort: number;
  readonly #onEvent: (event: import("@larness/shared").ServerEvent) => void;
  #port = 0;
  #active = 0;

  constructor(options: PreviewRegistryOptions) {
    this.#db = options.db;
    this.#services = options.services;
    this.#events = options.events;
    this.#hostSuffix = options.hostSuffix ?? "preview.localhost";
    this.#idleTtlMinutes = options.idleTtlMinutes ?? 30;
    this.#now = options.now ?? Date.now;
    this.#ticketTtlMs = options.ticketTtlMs ?? 30_000;
    this.#grantTtlMs = options.grantTtlMs ?? 15 * 60_000;
    this.#maxConnections = options.maxConnections ?? 256;
    this.#maxBodyBytes = options.maxBodyBytes ?? 16 * 1024 * 1024;
    this.#configuredPort = options.port ?? 3211;
    this.#server = createServer((req, res) => {
      void this.#handle(req, res).catch(() => {
        if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
        res.end("preview unavailable");
      });
    });
    this.#server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.on("close", () => this.#sockets.delete(socket));
    });
    this.#server.on("upgrade", (req, socket, head) => this.#upgrade(req, socket, head));
    this.#onEvent = (event) => {
      if (event.topic !== "service") return;
      const payload = event.payload as { status?: string } | undefined;
      if (event.type === "service.unregistered" || payload?.status !== "RUNNING") {
        this.revokeService(event.streamId);
      }
    };
    this.#events?.on(this.#onEvent);
  }

  get port(): number {
    return this.#port;
  }

  async start(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(this.#configuredPort, "127.0.0.1", () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    const address = this.#server.address();
    this.#port = typeof address === "object" && address ? address.port : 0;
    return this.#port;
  }

  async stop(): Promise<void> {
    this.#events?.off(this.#onEvent);
    for (const socket of this.#sockets) socket.destroy();
    this.#tickets.clear();
    this.#grants.clear();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async resolve(input: PreviewResolveInput, clientSessionId: string): Promise<ResolvedPreview> {
    const target = safePath(input.path);
    const service = await this.#services.verifyActive(input.serviceId).catch(() => {
      throw new FileManagerError("PREVIEW_UNAVAILABLE", "Service is not available for preview");
    });
    if (!this.#sessionActive(clientSessionId)) {
      throw new FileManagerError("PREVIEW_UNAVAILABLE", "Client session expired");
    }
    if (this.#port === 0) {
      throw new FileManagerError("PREVIEW_UNAVAILABLE", "Preview gateway is not running");
    }
    const mode = input.mode ?? "embedded";
    const host = `${randomBytes(6).toString("hex")}.${this.#hostSuffix}`;
    const ticket = randomBytes(32).toString("base64url");
    const expiresAt = this.#now() + this.#ticketTtlMs;
    this.#tickets.set(hash(ticket), {
      hash: hash(ticket),
      host,
      serviceId: service.id,
      path: target,
      mode,
      clientSessionId,
      expiresAt,
    });
    return {
      origin: `http://${host}:${this.#port}`,
      bootstrapUrl: `http://${host}:${this.#port}${BOOTSTRAP_PATH}`,
      ticket,
      expiresAt,
      mode,
    };
  }

  revokeService(serviceId: string): void {
    for (const [key, grant] of this.#grants) {
      if (grant.serviceId !== serviceId) continue;
      for (const socket of grant.sockets) socket.destroy();
      this.#grants.delete(key);
    }
    this.#verifyCache.delete(serviceId);
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const hostHeader = req.headers.host ?? "";
    const host = hostHeader.split(":")[0];
    if (!host.endsWith(`.${this.#hostSuffix}`)) {
      res.writeHead(421, { "cache-control": "no-store" });
      res.end("misdirected request");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${hostHeader}`);
    if (url.pathname === BOOTSTRAP_PATH) {
      await this.#bootstrap(req, res, host, url);
      return;
    }
    const grant = this.#authorize(host, req.headers.cookie);
    if (!grant) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("preview unauthorized");
      return;
    }
    if (this.#active >= this.#maxConnections) {
      res.writeHead(429, { "cache-control": "no-store" });
      res.end("preview connection limit");
      return;
    }
    try {
      const service = await this.#verify(grant.serviceId);
      this.#proxy(req, res, url, service.endpoint.port);
    } catch {
      this.revokeService(grant.serviceId);
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("preview unavailable");
    }
  }

  async #bootstrap(
    req: IncomingMessage,
    res: ServerResponse,
    host: string,
    url: URL,
  ): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405, { "cache-control": "no-store" });
      res.end("method not allowed");
      return;
    }
    const body = await readBody(req, 4096);
    if (body === null) {
      res.writeHead(413, { "cache-control": "no-store" });
      res.end("payload too large");
      return;
    }
    const parsed = parseQuery(body);
    const ticket = typeof parsed.ticket === "string" ? parsed.ticket : "";
    const record = this.#tickets.get(hash(ticket));
    if (
      !record ||
      record.host !== host ||
      record.expiresAt <= this.#now() ||
      !this.#sessionActive(record.clientSessionId)
    ) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("invalid ticket");
      return;
    }
    try {
      await this.#services.verifyActive(record.serviceId);
    } catch {
      this.#tickets.delete(record.hash);
      res.writeHead(401, { "cache-control": "no-store" });
      res.end("preview unavailable");
      return;
    }
    this.#tickets.delete(record.hash);
    const raw = randomBytes(32).toString("base64url");
    const grant: GrantRecord = {
      hash: hash(raw),
      host,
      serviceId: record.serviceId,
      clientSessionId: record.clientSessionId,
      expiresAt: this.#now() + this.#grantTtlMs,
      sockets: new Set(),
    };
    this.#grants.set(grant.hash, grant);
    res.writeHead(303, {
      location: safePath(url.searchParams.get("path") ?? record.path),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "set-cookie": `${GRANT_COOKIE}=${raw}; Path=/; HttpOnly; SameSite=None; Secure`,
    });
    res.end();
  }

  #authorize(host: string, cookie: string | undefined): GrantRecord | undefined {
    const raw = cookieValue(cookie, GRANT_COOKIE);
    if (!raw) return undefined;
    const grant = this.#grants.get(hash(raw));
    if (!grant || grant.host !== host) return undefined;
    if (grant.expiresAt <= this.#now() || !this.#sessionActive(grant.clientSessionId)) {
      this.revokeService(grant.serviceId);
      return undefined;
    }
    return grant;
  }

  async #verify(serviceId: string) {
    const cached = this.#verifyCache.get(serviceId);
    if (cached && this.#now() - cached.at < 2000 && cached.ok) {
      const dto = this.#services.get(serviceId);
      return dto;
    }
    try {
      const dto = await this.#services.verifyActive(serviceId);
      this.#verifyCache.set(serviceId, { at: this.#now(), ok: true });
      return dto;
    } catch (error) {
      this.#verifyCache.set(serviceId, { at: this.#now(), ok: false });
      throw error;
    }
  }

  #proxy(req: IncomingMessage, res: ServerResponse, url: URL, port: number): void {
    this.#active++;
    res.on("close", () => {
      this.#active--;
    });
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > this.#maxBodyBytes) {
      res.writeHead(413, { "cache-control": "no-store" });
      res.end("preview payload too large");
      req.resume();
      return;
    }
    const upstream = request(
      {
        host: "127.0.0.1",
        port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: upstreamHeaders(req.headers, port),
      },
      (upstreamResponse) => {
        res.writeHead(
          upstreamResponse.statusCode ?? 502,
          responseHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(res);
      },
    );
    let received = 0;
    let rejected = false;
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received <= this.#maxBodyBytes || rejected) return;
      rejected = true;
      req.unpipe(upstream);
      upstream.destroy();
      if (!res.headersSent) res.writeHead(413, { "cache-control": "no-store" });
      res.end("preview payload too large");
    });
    upstream.setTimeout(10_000, () => {
      if (!res.headersSent) res.writeHead(504, { "cache-control": "no-store" });
      res.end("preview upstream timeout");
      upstream.destroy();
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502, { "cache-control": "no-store" });
      res.end("preview upstream unavailable");
    });
    req.pipe(upstream);
  }

  #upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const host = (req.headers.host ?? "").split(":")[0];
    if (!host.endsWith(`.${this.#hostSuffix}`)) {
      socket.destroy();
      return;
    }
    const grant = this.#authorize(host, req.headers.cookie);
    if (!grant) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    let port = 0;
    try {
      port = this.#services.get(grant.serviceId).endpoint.port;
    } catch {
      socket.destroy();
      return;
    }
    if (grant.sockets.size >= 8) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = connect(port, "127.0.0.1");
    grant.sockets.add(socket as Socket);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    socket.on("close", () => {
      grant.sockets.delete(socket as Socket);
      upstream.destroy();
    });
    upstream.on("connect", () => {
      const lines = [`${req.method ?? "GET"} ${req.url ?? "/"} HTTP/1.1`];
      for (const [name, value] of Object.entries(upgradeHeaders(req.headers, port))) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
  }

  #sessionActive(clientSessionId: string): boolean {
    const row = this.#db
      .select()
      .from(browserSessions)
      .where(eq(browserSessions.id, clientSessionId))
      .get();
    if (!row || row.revokedAt !== null || row.expiresAt <= this.#now()) return false;
    return row.lastSeenAt + this.#idleTtlMinutes * 60_000 > this.#now();
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    let body = "";
    let bytes = 0;
    let done = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (done) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) {
        done = true;
        resolve(null);
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!done) resolve(body);
    });
    req.on("error", () => {
      if (!done) resolve(null);
    });
  });
}
