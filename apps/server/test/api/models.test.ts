import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("models and credentials API", () => {
  it("lists official presets and creates a connection from a preset", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);
      const app = started.running.app;
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      try {
        expect((await app.inject("/api/models/presets")).statusCode).toBe(401);
        const presets = await app.inject({ url: "/api/models/presets", headers });
        expect(presets.json()).toMatchObject({
          presets: expect.arrayContaining([
            expect.objectContaining({ id: "glm-coding-cn", provider: "glm" }),
          ]),
        });
        const payload = {
          presetId: "glm-coding-cn",
          label: "Coding",
          apiKey: "fixture-coding-secret",
        };
        const created = await app.inject({
          method: "POST",
          url: "/api/credentials",
          headers,
          payload,
        });
        expect(created.statusCode).toBe(201);
        expect(created.json()).toMatchObject({
          presetId: "glm-coding-cn",
          revision: 1,
          endpoint: "https://open.bigmodel.cn/api/coding/paas/v4",
        });
        expect(created.body).not.toContain(payload.apiKey);
        const mismatch = await app.inject({
          method: "POST",
          url: "/api/credentials",
          headers,
          payload: { ...payload, endpoint: "https://open.bigmodel.cn/api/paas/v4" },
        });
        expect(mismatch.statusCode).toBe(400);
        const { id } = created.json<{ id: string }>();
        const url = `/api/credentials/${id}`;
        const rotated = await app.inject({
          method: "PATCH",
          url,
          headers,
          payload: { revision: 1, apiKey: "fixture-replacement-secret", label: "New label" },
        });
        expect(rotated.statusCode).toBe(200);
        expect(rotated.json()).toMatchObject({
          id,
          revision: 2,
          label: "New label",
          presetId: "glm-coding-cn",
        });
        expect(rotated.body).not.toContain("fixture-replacement-secret");
        const stale = await app.inject({
          method: "PATCH",
          url,
          headers,
          payload: { revision: 1, apiKey: "fixture-stale-secret" },
        });
        expect(stale.statusCode).toBe(409);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("lists models, stores encrypted credentials and protects references", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);

      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };

        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/models",
        });
        expect(unauthenticated.statusCode).toBe(401);

        const models = await started.running.app.inject({
          method: "GET",
          url: "/api/models",
          headers: { cookie: started.cookie },
        });
        expect(models.statusCode).toBe(200);
        expect(models.json()).toMatchObject({
          models: [
            {
              id: "deepseek-default",
              provider: "deepseek",
              model: "deepseek-chat",
            },
          ],
        });

        const created = await started.running.app.inject({
          method: "POST",
          url: "/api/credentials",
          headers: auth,
          payload: { provider: "deepseek", label: "DeepSeek", apiKey: "sk-api-secret" },
        });
        expect(created.statusCode).toBe(201);
        const credential = created.json() as {
          id: string;
          masked: string;
          secretRef: string;
        };
        expect(credential.masked).toBe("••••••");
        expect(created.body).not.toContain("sk-api-secret");
        expect(credential.secretRef).toMatch(/^sec_/);

        const list = await started.running.app.inject({
          method: "GET",
          url: "/api/credentials",
          headers: { cookie: started.cookie },
        });
        expect(list.body).not.toContain("sk-api-secret");
        expect(list.json()).toMatchObject({
          credentials: [{ id: credential.id, masked: "••••••" }],
        });

        const model = await started.running.app.inject({
          method: "POST",
          url: "/api/models",
          headers: auth,
          payload: {
            label: "Explicit DeepSeek",
            provider: "deepseek",
            model: "deepseek-chat",
            credentialProfileId: credential.id,
          },
        });
        expect(model.statusCode).toBe(201);
        expect(model.json()).toMatchObject({
          credentialProfileId: credential.id,
          credentialLabel: "DeepSeek",
        });

        const blockedDelete = await started.running.app.inject({
          method: "DELETE",
          url: `/api/credentials/${credential.id}`,
          headers: auth,
        });
        expect(blockedDelete.statusCode).toBe(409);
        expect(blockedDelete.json()).toMatchObject({ error: { code: "CONFLICT" } });

        const unused = await started.running.app.inject({
          method: "POST",
          url: "/api/credentials",
          headers: auth,
          payload: { provider: "deepseek", label: "Unused", apiKey: "sk-unused" },
        });
        const unusedId = (unused.json() as { id: string }).id;
        const deleted = await started.running.app.inject({
          method: "DELETE",
          url: `/api/credentials/${unusedId}`,
          headers: auth,
        });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json()).toEqual({ ok: true });

        const invalid = await started.running.app.inject({
          method: "POST",
          url: "/api/credentials",
          headers: auth,
          payload: { provider: "deepseek", label: "x", apiKey: "" },
        });
        expect(invalid.statusCode).toBe(400);

        const masterKey = started.running.sqlite.prepare("SELECT count(*) AS n FROM secrets").get();
        expect(masterKey).toEqual({ n: 1 });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
  it("serves the official catalog with auth, CSRF and cached models", async () => {
    await withTempDir(async (dir) => {
      let upstreamCalls = 0;
      const started = await startAuthorizedServer(dir, {
        catalogFetcher: async () => {
          upstreamCalls += 1;
          return {
            object: "list",
            data: [{ id: "deepseek-flash" }, { id: "deepseek-chat" }],
          };
        },
      });

      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };

        const anonymous = await started.running.app.inject({
          method: "GET",
          url: "/api/models/catalog",
        });
        expect(anonymous.statusCode).toBe(401);

        const noCredential = await started.running.app.inject({
          method: "GET",
          url: "/api/models/catalog",
          headers: { cookie: started.cookie },
        });
        expect(noCredential.statusCode).toBe(409);
        expect(noCredential.json()).toMatchObject({
          error: { code: "MODEL_CREDENTIAL_MISSING" },
        });

        const credential = await started.running.app.inject({
          method: "POST",
          url: "/api/credentials",
          headers: auth,
          payload: { provider: "deepseek", label: "DeepSeek Key", apiKey: "sk-test" },
        });
        expect(credential.statusCode).toBe(201);

        const empty = await started.running.app.inject({
          method: "GET",
          url: "/api/models/catalog",
          headers: { cookie: started.cookie },
        });
        expect(empty.statusCode).toBe(200);
        expect(empty.json()).toMatchObject({ syncedAt: null, stale: true, models: [] });

        const missingCsrf = await started.running.app.inject({
          method: "POST",
          url: "/api/models/catalog/refresh",
          headers: { cookie: started.cookie, origin: started.origin },
          payload: {},
        });
        expect(missingCsrf.statusCode).toBe(403);
        expect(missingCsrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
        expect(upstreamCalls).toBe(0);

        const refreshed = await started.running.app.inject({
          method: "POST",
          url: "/api/models/catalog/refresh",
          headers: auth,
          payload: {},
        });
        expect(refreshed.statusCode).toBe(200);
        expect(refreshed.json()).toMatchObject({
          credentialLabel: "DeepSeek Key",
          stale: false,
          models: [
            { id: "deepseek-flash", contextWindow: 1_048_576, default: true },
            { id: "deepseek-chat", contextWindow: 128_000, default: false },
          ],
        });
        expect(upstreamCalls).toBe(1);

        const cached = await started.running.app.inject({
          method: "GET",
          url: "/api/models/catalog",
          headers: { cookie: started.cookie },
        });
        expect(cached.json()).toMatchObject({ stale: false });
        expect(upstreamCalls).toBe(1);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
