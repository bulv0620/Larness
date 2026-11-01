import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /api/health", () => {
  it("reports ok with a non-negative uptime", async () => {
    const app = createApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/health" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("application/json");

      const body = response.json();
      expect(body.status).toBe("ok");
      expect(typeof body.uptimeMs).toBe("number");
      expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(response.headers["x-request-id"]).toMatch(/^[A-Za-z0-9._:-]+$/);
    } finally {
      await app.close();
    }
  });

  it("echoes a valid client request id", async () => {
    const app = createApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { "x-request-id": "trace.abc-123" },
      });

      expect(response.headers["x-request-id"]).toBe("trace.abc-123");
    } finally {
      await app.close();
    }
  });

  it("replaces an invalid client request id", async () => {
    const app = createApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/health",
        headers: { "x-request-id": "not a valid id!" },
      });

      expect(response.headers["x-request-id"]).not.toBe("not a valid id!");
      expect(response.headers["x-request-id"]).toMatch(/^req_[0-9a-f-]{36}$/);
    } finally {
      await app.close();
    }
  });
});
