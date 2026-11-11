import type { HostMetrics } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import type { Database } from "../db/client.js";
import type { HostMetricsService } from "../modules/system/metrics.js";
import { type StorageReport, storageReport } from "../modules/system/storage.js";

export interface SystemApiDeps {
  metrics: HostMetricsService;
  db: Database;
  dataDir: string;
  now?: () => number;
}

export function registerSystemRoutes(app: FastifyInstance, deps: SystemApiDeps): void {
  app.get("/api/system/metrics", async (): Promise<HostMetrics> => deps.metrics.sample());

  // Read-only volume report (M6 TR-1). Retention is reported as a dry-run only.
  app.get(
    "/api/system/storage",
    async (): Promise<StorageReport> =>
      storageReport(deps.db, {
        dataDir: deps.dataDir,
        ...(deps.now === undefined ? {} : { now: deps.now() }),
      }),
  );
}
