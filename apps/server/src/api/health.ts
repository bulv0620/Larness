import type { FastifyInstance } from "fastify";

export interface HealthResponse {
  status: "ok";
  uptimeMs: number;
}

export function registerHealthRoute(app: FastifyInstance, startedAt: number): void {
  app.get("/api/health", async (): Promise<HealthResponse> => {
    return { status: "ok", uptimeMs: Math.max(0, Date.now() - startedAt) };
  });
}
