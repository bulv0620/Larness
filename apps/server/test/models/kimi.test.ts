import path from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { refreshModelCatalog } from "../../src/modules/models/catalog.js";
import { createCredential } from "../../src/modules/models/service.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

it("keeps Kimi Code separate from the open platform and matches each catalog namespace", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    const secretStore = await SecretStore.open(dir);
    const options = { db: opened.db, secretStore };
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      const open = createCredential(options, {
        presetId: "kimi-api-cn",
        label: "Kimi API",
        apiKey: "fixture",
      });
      const code = createCredential(options, {
        presetId: "kimi-code-intl",
        label: "Kimi Code",
        apiKey: "fixture",
      });
      expect(open.endpoint).toBe("https://api.moonshot.cn/v1");
      expect(code.endpoint).toBe("https://api.kimi.ai/coding/v1");
      fetcher.mockResolvedValueOnce(Response.json({ data: [{ id: "kimi-k3" }] }));
      const catalog = await refreshModelCatalog(
        {
          ...options,
          publicDirectoryFetcher: async () => ({
            "moonshotai-cn": { models: { "kimi-k3": { limit: { context: 500_000 } } } },
            "kimi-code-plan-global": {
              models: {
                k3: {
                  limit: { context: 750_000 },
                  modalities: { output: ["text"] },
                  tool_call: true,
                },
              },
            },
          }),
        },
        { includePublicDirectory: true },
      );
      expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["https://api.moonshot.cn/v1/models"]);
      expect(catalog.groups.find((group) => group.credentialProfileId === code.id)).toMatchObject({
        candidatesOnly: true,
        billing: "subscription",
        models: [{ id: "k3", contextWindow: 750_000 }],
      });
      expect(catalog.groups.find((group) => group.credentialProfileId === open.id)).toMatchObject({
        candidatesOnly: false,
        billing: "usage",
        models: [{ id: "kimi-k3", contextWindow: 500_000 }],
      });
    } finally {
      fetcher.mockRestore();
      opened.close();
    }
  });
});
