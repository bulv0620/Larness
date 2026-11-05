import path from "node:path";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isDevPath } from "../dev-web/paths.js";
import { HttpError } from "../errors.js";

export const APP_CSP = [
  "default-src 'self'",
  // Monaco TypeScript worker uses Function/eval internally; no remote scripts are allowed.
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  // The isolated preview runs in a random *.preview.localhost iframe and receives
  // its one-time ticket through a POST form. Management pages must never be
  // frameable themselves (frame-ancestors below).
  "frame-src 'self' http://*.preview.localhost:*",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' http://*.preview.localhost:*",
  "object-src 'none'",
].join("; ");

export interface StaticRoutesOptions {
  webDistDir: string;
}

export function registerStaticRoutes(app: FastifyInstance, options: StaticRoutesOptions): void {
  app.register(fastifyStatic, {
    root: options.webDistDir,
    serve: false,
    decorateReply: true,
  });

  app.get<{ Params: { "*": string } }>("/assets/*", async (request, reply) => {
    const asset = request.params["*"];

    if (asset.length === 0 || asset.includes("..")) {
      throw new HttpError("NOT_FOUND", "Not found");
    }

    return reply.sendFile(path.join("assets", asset), {
      maxAge: "1y",
      immutable: true,
    });
  });

  app.get("/favicon.svg", async (_request, reply) => {
    return reply.sendFile("favicon.svg", { maxAge: "1d" });
  });

  const indexHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(request.url.split("?")[0] ?? "");
    } catch {
      throw new HttpError("NOT_FOUND", "Not found");
    }
    if (
      pathname === "/api" ||
      pathname.startsWith("/api/") ||
      pathname === "/ws" ||
      pathname.startsWith("/ws/") ||
      isDevPath(pathname)
    ) {
      throw new HttpError("NOT_FOUND", "Not found");
    }

    reply.header("cache-control", "no-store");
    return reply.sendFile("index.html", {
      cacheControl: false,
      lastModified: false,
      etag: false,
    });
  };

  app.get("/", indexHandler);
  app.get("/*", indexHandler);
}
