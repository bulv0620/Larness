import { describe, expect, it } from "vitest";
import { WebSearchService } from "../../src/modules/web-search/service.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const fakeService = () =>
  new WebSearchService({
    providerFactory: () => ({
      search: async () => [{ title: "t", url: "https://example.com", snippet: "s", summary: "m" }],
      fetch: async () => ({ title: "page", content: "body" }),
    }),
    now: () => 1_000,
  });

describe("web search API", () => {
  it("keeps search credentials isolated and masked", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir, { webSearchService: fakeService() });
      const app = started.running.app;
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      try {
        expect((await app.inject("/api/web-search/connections")).statusCode).toBe(401);

        const created = await app.inject({
          method: "POST",
          url: "/api/web-search/connections",
          headers,
          payload: { provider: "deepseek", label: "DeepSeek 搜索", apiKey: "sk-secret" },
        });
        expect(created.statusCode).toBe(201);
        const connection = created.json<{ id: string; maskedKey: string }>();
        expect(connection.maskedKey).toBe("••••••");
        expect(JSON.stringify(created.json())).not.toContain("sk-secret");

        const settings = await app.inject({ url: "/api/web-search/settings", headers });
        expect(settings.json()).toMatchObject({
          activeConnectionId: connection.id,
          maxResults: 5,
          maxSearchesPerTurn: 6,
          maxFetchesPerTurn: 4,
          connections: [{ id: connection.id, provider: "deepseek", maskedKey: "••••••" }],
        });

        const tested = await app.inject({
          method: "POST",
          url: `/api/web-search/connections/${connection.id}/test`,
          headers,
        });
        expect(tested.statusCode).toBe(200);
        expect(tested.json()).toMatchObject({ ok: true, latencyMs: 0, resultCount: 1 });

        const updated = await app.inject({
          method: "PATCH",
          url: `/api/web-search/connections/${connection.id}`,
          headers,
          payload: { apiKey: "sk-rotated", label: "Rotated" },
        });
        expect(updated.statusCode).toBe(200);
        expect(updated.json()).toMatchObject({ label: "Rotated" });
        expect(JSON.stringify(updated.json())).not.toContain("sk-rotated");

        const removed = await app.inject({
          method: "DELETE",
          url: `/api/web-search/connections/${connection.id}`,
          headers,
        });
        expect(removed.statusCode).toBe(200);
        expect((await app.inject({ url: "/api/web-search/connections", headers })).json()).toEqual({
          connections: [],
        });
        expect(
          (await app.inject({ url: "/api/web-search/settings", headers })).json(),
        ).toMatchObject({ activeConnectionId: null });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("accepts GLM global and rejects invalid settings or regions", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir, { webSearchService: fakeService() });
      const app = started.running.app;
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      try {
        const glm = await app.inject({
          method: "POST",
          url: "/api/web-search/connections",
          headers,
          payload: {
            provider: "glm",
            label: "GLM Global",
            region: "global",
            apiKey: "glm-key",
          },
        });
        expect(glm.statusCode).toBe(201);
        expect(glm.json()).toMatchObject({
          provider: "glm",
          region: "global",
          endpoint: "https://api.z.ai/api/paas/v4",
        });

        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/web-search/connections",
              headers,
              payload: { provider: "deepseek", label: "bad", apiKey: "k", region: "cn" },
            })
          ).statusCode,
        ).toBe(400);

        expect(
          (
            await app.inject({
              method: "PUT",
              url: "/api/web-search/settings",
              headers,
              payload: {
                activeConnectionId: "wsc_missing",
                maxResults: 5,
                maxSearchesPerTurn: 6,
                maxFetchesPerTurn: 4,
              },
            })
          ).statusCode,
        ).toBe(400);

        const saved = await app.inject({
          method: "PUT",
          url: "/api/web-search/settings",
          headers,
          payload: {
            activeConnectionId: glm.json<{ id: string }>().id,
            maxResults: 8,
            maxSearchesPerTurn: 3,
            maxFetchesPerTurn: 2,
          },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json()).toMatchObject({
          maxResults: 8,
          maxSearchesPerTurn: 3,
          maxFetchesPerTurn: 2,
        });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
