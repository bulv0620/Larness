import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { HttpError } from "../src/errors.js";

describe("error contract", () => {
  it("returns NOT_FOUND for an unknown route", async () => {
    const app = createApp();
    try {
      const response = await app.inject({ method: "GET", url: "/api/unknown" });

      expect(response.statusCode).toBe(404);
      expect(response.headers["content-type"]).toContain("application/json");

      const body = response.json();
      expect(body.error.code).toBe("NOT_FOUND");
      expect(typeof body.error.message).toBe("string");
      expect(body.error.requestId).toBe(response.headers["x-request-id"]);
    } finally {
      await app.close();
    }
  });

  it("maps HttpError to its stable code and status", async () => {
    const app = createApp();
    app.get("/api/forbidden", async () => {
      throw new HttpError("FORBIDDEN", "Not allowed");
    });
    try {
      const response = await app.inject({ method: "GET", url: "/api/forbidden" });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: { code: "FORBIDDEN", message: "Not allowed" },
      });
    } finally {
      await app.close();
    }
  });

  it("hides unexpected error details and never returns a stack", async () => {
    const app = createApp();
    app.get("/api/boom", async () => {
      throw new Error("secret stack detail");
    });
    try {
      const response = await app.inject({ method: "GET", url: "/api/boom" });

      expect(response.statusCode).toBe(500);

      const raw = response.body;
      expect(raw).not.toContain("secret stack detail");
      expect(raw).not.toContain("    at ");

      const body = response.json();
      expect(body.error.code).toBe("INTERNAL");
      expect(body.error.message).toBe("Internal server error");
      expect(body.error.requestId).toBe(response.headers["x-request-id"]);
    } finally {
      await app.close();
    }
  });
});
