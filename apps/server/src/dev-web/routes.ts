import { randomBytes } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { AppConfig } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { WebSocket } from "ws";
import { z } from "zod";
import { APP_CSP } from "../api/static.js";
import { HttpError } from "../errors.js";
import { sessionEvents } from "../security/session-events.js";
import { transportAllowed } from "../security/transport.js";
import { type DevWebTarget, DevWebTargetSchema, HMR_PATH, NONCE_MARKER } from "./control.js";
import { permittedPath } from "./paths.js";

export interface DevWebOptions {
  target: DevWebTarget;
  webRoot: string;
  roots: string[];
  config: AppConfig;
  origin: string;
  resolveSession(request: FastifyRequest): { id: string; deviceId: string | null } | null;
  auditReject?(code: string): void;
}
const MAX_RESPONSE = 32 * 1024 * 1024;
const MAX_BUFFERED = 8 * 1024 * 1024;
const RequestBoundary = z.object({
  url: z.string().max(8192),
  headers: z.object({ host: z.string().min(1).max(2048), origin: z.string().max(2048).optional() }),
});
const HmrQuery = z.strictObject({ token: z.string().min(1).max(256) });
const forbiddenHeaders = new Set([
  "cookie",
  "authorization",
  "proxy-authorization",
  "x-csrf-token",
  "forwarded",
  "host",
  "connection",
  "upgrade",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "proxy-authenticate",
  "set-cookie",
  "if-none-match",
  "if-modified-since",
  "range",
  "if-range",
]);
function cleanHeaders(headers: IncomingHttpHeaders, response = false): IncomingHttpHeaders {
  const connectionNames = String(headers.connection ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim());
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        !forbiddenHeaders.has(name) &&
        !connectionNames.includes(name) &&
        !name.startsWith("x-forwarded-") &&
        !(
          response &&
          (name.startsWith("access-control-") ||
            name === "content-security-policy" ||
            name === "location")
        ),
    ),
  );
}
class LimitedBody extends Transform {
  private bytes = 0;
  private decoder = new StringDecoder("utf8");
  private carry = "";
  constructor(private nonce: string | null) {
    super();
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    done: (error?: Error | null) => void,
  ): void {
    this.bytes += chunk.length;
    if (this.bytes > MAX_RESPONSE) {
      done(new Error("response limit"));
      return;
    }
    if (!this.nonce) this.push(chunk);
    else {
      const value = this.carry + this.decoder.write(chunk);
      // Keep an unfinished marker intact across chunk boundaries.
      let cut = Math.max(0, value.length - NONCE_MARKER.length + 1);
      const marker = value.lastIndexOf(NONCE_MARKER, cut);
      if (marker >= 0 && marker + NONCE_MARKER.length > cut) cut = marker;
      this.push(value.slice(0, cut).replaceAll(NONCE_MARKER, this.nonce));
      this.carry = value.slice(cut);
    }
    done();
  }
  override _flush(done: (error?: Error | null) => void): void {
    if (this.nonce)
      this.push((this.carry + this.decoder.end()).replaceAll(NONCE_MARKER, this.nonce));
    done();
  }
}

export function registerDevWeb(app: FastifyInstance, options: DevWebOptions): void {
  const target = DevWebTargetSchema.parse(options.target);
  const canonical = new URL(options.origin);
  const nonces = new WeakMap<FastifyRequest, string>();
  const active = new Set<() => void>();
  const connections = new Map<WebSocket, { id: string; deviceId: string | null; stop(): void }>();
  const reject = (code: "ORIGIN_INVALID" | "HTTPS_REQUIRED" | "UNAUTHENTICATED") => {
    options.auditReject?.(code);
    throw new HttpError(code, "开发连接不可用");
  };
  const verify = (request: FastifyRequest, hmr = false) => {
    if (!RequestBoundary.safeParse(request).success) reject("ORIGIN_INVALID");
    let host: URL;
    try {
      host = new URL(`http://${request.headers.host ?? ""}`);
    } catch {
      return reject("ORIGIN_INVALID");
    }
    const alias =
      canonical.hostname === "localhost" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(host.hostname);
    if (host.hostname !== canonical.hostname && !alias) reject("ORIGIN_INVALID");
    if (request.headers.origin !== undefined && request.headers.origin !== options.origin)
      reject("ORIGIN_INVALID");
    if (hmr && request.headers.origin !== options.origin) reject("ORIGIN_INVALID");
    if (!transportAllowed(request, options.config.auth)) reject("HTTPS_REQUIRED");
  };
  app.addHook("onSend", async (request, reply, payload) => {
    const nonce = nonces.get(request);
    if (nonce)
      reply.header(
        "content-security-policy",
        APP_CSP.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`),
      );
    return payload;
  });
  const forward = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!permittedPath(request.raw.url ?? request.url, options.webRoot, options.roots))
      throw new HttpError("NOT_FOUND", "Not found");
    verify(request);
    return new Promise<void>((resolve, rejectPromise) => {
      let settled = false;
      let responseStarted = false;
      const unavailable = () => {
        if (settled) return;
        settled = true;
        cleanup();
        upstream.destroy();
        if (responseStarted) reply.raw.destroy();
        else
          rejectPromise(new HttpError("DEV_WEB_UNAVAILABLE", "开发页面暂不可用，请查看本机 TUI"));
      };
      const headers = cleanHeaders(request.headers);
      // Identity encoding permits nonce replacement and accurate size limits.
      headers["accept-encoding"] = "identity";
      const upstream = httpRequest({
        host: target.host,
        port: target.port,
        method: request.method,
        path: request.raw.url,
        headers,
      });
      const timer = setTimeout(unavailable, 5000);
      const stop = () => {
        upstream.destroy();
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      active.add(stop);
      const cleanup = () => {
        clearTimeout(timer);
        active.delete(stop);
        reply.raw.off("close", stop);
      };
      reply.raw.once("close", stop);
      upstream.once("error", unavailable);
      upstream.once("response", (response) => {
        clearTimeout(timer);
        if (settled) {
          response.destroy();
          return;
        }
        if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
          response.destroy();
          unavailable();
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (
          declared > MAX_RESPONSE ||
          (response.headers["content-encoding"] &&
            response.headers["content-encoding"] !== "identity")
        ) {
          response.destroy();
          unavailable();
          return;
        }
        const html = String(response.headers["content-type"] ?? "").includes("text/html");
        const nonce = html ? randomBytes(24).toString("base64") : null;
        if (nonce) nonces.set(request, nonce);
        const safe = cleanHeaders(response.headers, true);
        delete safe["content-length"];
        delete safe.etag;
        for (const [key, value] of Object.entries(safe))
          if (value !== undefined) reply.header(key, value);
        reply.header("cache-control", "no-store");
        reply.code(response.statusCode ?? 503);
        response.setTimeout(30_000, () => response.destroy());
        const body = new LimitedBody(nonce);
        response.on("error", () => body.destroy(new Error("upstream closed")));
        body.on("error", () => {
          response.destroy();
          upstream.destroy();
        });
        body.once("close", () => {
          settled = true;
          cleanup();
          resolve();
        });
        responseStarted = true;
        void reply.send(response.pipe(body));
      });
      upstream.end();
    });
  };
  app.get("/*", forward);
  app.get("/", forward);
  app.after(() => {
    // The shared upgrade server must bound frames before allocating HMR payloads.
    app.websocketServer.options.maxPayload = Math.min(
      app.websocketServer.options.maxPayload ?? 1024 * 1024,
      1024 * 1024,
    );
    app.route({
      method: "GET",
      url: HMR_PATH,
      logLevel: "silent",
      handler: async () => {
        throw new HttpError("NOT_FOUND", "Not found");
      },
      preValidation: async (request) => {
        if (request.headers.upgrade?.toLowerCase() !== "websocket") return;
        verify(request, true);
        if (!options.resolveSession(request)) reject("UNAUTHENTICATED");
        if (!HmrQuery.safeParse(request.query).success)
          throw new HttpError("NOT_FOUND", "Not found");
        if (request.headers["sec-websocket-protocol"] !== "vite-hmr")
          throw new HttpError("NOT_FOUND", "Not found");
      },
      wsHandler: (browser, request) => {
        const session = options.resolveSession(request);
        if (!session) {
          browser.close(1008);
          return;
        }
        const headers = cleanHeaders(request.headers);
        for (const name of Object.keys(headers))
          if (name.startsWith("sec-websocket-")) delete headers[name];
        const url = `ws://${target.host}:${target.port}${request.raw.url}`;
        const upstream = new WebSocket(url, "vite-hmr", {
          headers,
          maxPayload: 1024 * 1024,
          handshakeTimeout: 5000,
        });
        let pending: { data: Buffer; binary: boolean }[] = [];
        let pendingBytes = 0;
        const timer = setInterval(() => {
          if (!options.resolveSession(request)) stop();
        }, 25_000);
        timer.unref();
        const stop = () => {
          clearInterval(timer);
          pending = [];
          pendingBytes = 0;
          connections.delete(browser);
          active.delete(stop);
          browser.terminate();
          upstream.terminate();
        };
        connections.set(browser, { ...session, stop });
        active.add(stop);
        const relay = (socket: WebSocket, data: Buffer, binary: boolean) => {
          if (data.length > 1024 * 1024 || socket.bufferedAmount + data.length > MAX_BUFFERED) {
            stop();
            return;
          }
          if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary });
        };
        browser.on("message", (data, binary) => {
          const value = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : Buffer.concat(data));
          if (upstream.readyState === WebSocket.CONNECTING) {
            pendingBytes += value.length;
            if (value.length > 1024 * 1024 || pendingBytes > MAX_BUFFERED) stop();
            else pending.push({ data: value, binary });
          } else relay(upstream, value, binary);
        });
        upstream.on("open", () => {
          for (const item of pending) relay(upstream, item.data, item.binary);
          pending = [];
          pendingBytes = 0;
        });
        upstream.on("message", (data, binary) => {
          const value = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : Buffer.concat(data));
          relay(browser, value, binary);
        });
        browser.on("error", stop);
        browser.on("close", stop);
        upstream.on("error", stop);
        upstream.on("close", stop);
      },
    });
  });
  const revoke = (event: { sessionId?: string; deviceId?: string }) => {
    for (const connection of connections.values())
      if (
        event.sessionId === connection.id ||
        (event.deviceId && event.deviceId === connection.deviceId)
      )
        connection.stop();
  };
  sessionEvents.on("session.revoked", revoke);
  sessionEvents.on("device.revoked", revoke);
  app.addHook("preClose", async () => {
    for (const stop of [...active]) stop();
    sessionEvents.off("session.revoked", revoke);
    sessionEvents.off("device.revoked", revoke);
  });
}
