import type { BrowserSessionRow } from "../db/schema.js";

declare module "fastify" {
  interface FastifyRequest {
    clientSession: BrowserSessionRow | null;
  }
}
