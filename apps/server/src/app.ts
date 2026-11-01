import Fastify, { type FastifyInstance } from "fastify";
import { registerHealthRoute } from "./api/health.js";
import { registerErrorHandler } from "./errors.js";
import { resolveRequestId } from "./request-id.js";

export interface CreateAppOptions {
  startedAt?: number;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const startedAt = options.startedAt ?? Date.now();

  const app = Fastify({
    logger: false,
    requestIdHeader: false,
    genReqId: (request) => resolveRequestId(request.headers["x-request-id"]),
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);

    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
    }

    return payload;
  });

  registerErrorHandler(app);
  registerHealthRoute(app, startedAt);

  return app;
}
