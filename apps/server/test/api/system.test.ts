import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("GET /api/system/metrics", () => {
  it("returns the server host resource usage to an authenticated session", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);

      try {
        const anonymous = await started.running.app.inject({
          method: "GET",
          url: "/api/system/metrics",
        });
        expect(anonymous.statusCode).toBe(401);

        const response = await started.running.app.inject({
          method: "GET",
          url: "/api/system/metrics",
          headers: { cookie: started.cookie },
        });

        expect(response.statusCode).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const metrics = response.json() as Record<string, unknown>;
        expect(Object.keys(metrics).sort()).toEqual([
          "cpuPercent",
          "diskTotalBytes",
          "diskUsedBytes",
          "memoryTotalBytes",
          "memoryUsedBytes",
          "sampledAt",
        ]);
        expect(metrics.cpuPercent).toBeGreaterThanOrEqual(0);
        expect(metrics.cpuPercent).toBeLessThanOrEqual(100);
        expect(metrics.memoryTotalBytes).toBeGreaterThan(0);
        expect(metrics.memoryUsedBytes).toBeGreaterThanOrEqual(0);
        expect(metrics.diskTotalBytes).toBeGreaterThan(0);
        expect(metrics.diskUsedBytes).toBeGreaterThanOrEqual(0);
        expect(metrics.sampledAt).toEqual(expect.any(Number));
        expect(response.body).not.toContain(dir);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
