import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("models and credentials API", () => {
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
});
