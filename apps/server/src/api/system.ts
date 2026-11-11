import type { HostMetrics } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import type { HostMetricsService } from "../modules/system/metrics.js";

export interface SystemApiDeps {
  metrics: HostMetricsService;
}

export function registerSystemRoutes(app: FastifyInstance, deps: SystemApiDeps): void {
  app.get("/api/system/metrics", async (): Promise<HostMetrics> => deps.metrics.sample());
}
