import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  CatalogHttpError,
  type CatalogOptions,
  getModelCatalog,
  mapThinkingSetting,
  refreshModelCatalog,
  resolveCatalogSelection,
} from "../../src/modules/models/catalog.js";
import { createCredential, listModelDtos, ModelError } from "../../src/modules/models/service.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

async function fixture(dir: string): Promise<{
  opened: OpenedDatabase;
  store: SecretStore;
  options: CatalogOptions;
}> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const store = await SecretStore.open(dir);
  return {
    opened,
    store,
    options: { db: opened.db, secretStore: store },
  };
}

function catalogResponse(ids: string[]): unknown {
  return { object: "list", data: ids.map((id) => ({ id, object: "model", owned_by: "deepseek" })) };
}

describe("deepseek model catalog", () => {
  it("requires a credential and starts empty", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        expect(() => getModelCatalog(options)).toThrowError(ModelError);

        try {
          getModelCatalog(options);
        } catch (error) {
          expect((error as ModelError).code).toBe("MODEL_CREDENTIAL_MISSING");
        }
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("refreshes from the official endpoint and merges built-in windows and levels", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-test",
          clientSessionId: "bs_test",
        });

        const before = getModelCatalog(options);
        expect(before).toMatchObject({ syncedAt: null, stale: true, models: [] });

        let seenApiKey: string | undefined;
        const catalog = await refreshModelCatalog(
          {
            ...options,
            now: () => 5_000,
            fetcher: async (apiKey) => {
              seenApiKey = apiKey;
              return catalogResponse(["deepseek-flash", "deepseek-chat"]);
            },
          },
          { clientSessionId: "bs_test" },
        );

        expect(seenApiKey).toBe("sk-test");
        expect(catalog).toMatchObject({
          credentialLabel: "DeepSeek Key",
          syncedAt: 5_000,
          stale: false,
          lastRefreshError: null,
        });
        expect(catalog.models.map((model) => model.id)).toEqual([
          "deepseek-flash",
          "deepseek-chat",
        ]);

        const flash = catalog.models[0];
        expect(flash).toMatchObject({
          id: "deepseek-flash",
          contextWindow: 1_048_576,
          default: true,
          thinking: {
            supported: true,
            levels: [{ id: "low" }, { id: "medium" }, { id: "high" }],
          },
        });
        expect(catalog.models[1]).toMatchObject({
          id: "deepseek-chat",
          contextWindow: 128_000,
          thinking: { supported: false, levels: [] },
        });

        expect(getModelCatalog(options)).toMatchObject({ syncedAt: 5_000, stale: false });
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("keeps the previous catalog and records the error when refresh fails", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-test",
        });

        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash"]) },
          { clientSessionId: "bs_test" },
        );

        const failed = await refreshModelCatalog(
          {
            ...options,
            fetcher: async () => {
              throw new CatalogHttpError(429, "rate limited");
            },
          },
          { clientSessionId: "bs_test" },
        );

        expect(failed).toMatchObject({ stale: true, lastRefreshError: "PROVIDER_RATE_LIMITED" });
        expect(failed.models.map((model) => model.id)).toEqual(["deepseek-flash"]);
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("rejects malformed upstream payloads without overwriting the cache", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-test",
        });

        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash"]) },
          { clientSessionId: "bs_test" },
        );

        const failed = await refreshModelCatalog(
          { ...options, fetcher: async () => ({ nope: true }) },
          { clientSessionId: "bs_test" },
        );

        expect(failed).toMatchObject({ lastRefreshError: "MODEL_CATALOG_INVALID" });
        expect(failed.models.map((model) => model.id)).toEqual(["deepseek-flash"]);
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("keeps caches per credential instead of leaking across keys", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "First",
          apiKey: "sk-first",
        });
        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash"]) },
          { clientSessionId: "bs_test" },
        );

        createCredential(options, {
          provider: "deepseek",
          label: "Second",
          apiKey: "sk-second",
        });

        const catalog = getModelCatalog(options);
        expect(catalog).toMatchObject({ syncedAt: null, stale: true, models: [] });
        expect(catalog.groups).toHaveLength(2);
        const first = catalog.groups.find((group) => group.credentialLabel === "First");
        expect(first?.models.map((model) => model.id)).toEqual(["deepseek-flash"]);
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("validates model and thinking combinations before a turn", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-test",
        });
        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash", "deepseek-chat"]) },
          { clientSessionId: "bs_test" },
        );

        const credentialProfileId = getModelCatalog(options).credentialProfileId;
        expect(resolveCatalogSelection(options.db, { model: "deepseek-flash" })).toEqual({
          model: "deepseek-flash",
          thinking: "medium",
          contextWindow: 1_048_576,
          credentialProfileId,
        });
        expect(
          resolveCatalogSelection(options.db, { model: "deepseek-flash", thinking: "medium" }),
        ).toMatchObject({ thinking: "medium" });
        expect(
          resolveCatalogSelection(options.db, { model: "deepseek-flash", thinking: "default" }),
        ).toMatchObject({ thinking: "medium" });
        expect(
          resolveCatalogSelection(options.db, { model: "deepseek-flash", thinking: "high" }),
        ).toMatchObject({ thinking: "high" });
        expect(
          resolveCatalogSelection(options.db, { model: "deepseek-flash", thinking: "off" }),
        ).toMatchObject({ thinking: "off" });

        expect(() =>
          resolveCatalogSelection(options.db, { model: "deepseek-flash", thinking: "ultra" }),
        ).toThrowError(ModelError);
        expect(() =>
          resolveCatalogSelection(options.db, { model: "deepseek-chat", thinking: "high" }),
        ).toThrowError(ModelError);
        expect(() => resolveCatalogSelection(options.db, { model: "unknown-model" })).toThrowError(
          ModelError,
        );

        expect(mapThinkingSetting("off")).toEqual({ enabled: false });
        expect(mapThinkingSetting("low")).toEqual({ enabled: true, effort: "low" });
        expect(mapThinkingSetting("medium")).toEqual({ enabled: true, effort: "high" });
        expect(mapThinkingSetting("high")).toEqual({ enabled: true, effort: "max" });
      } finally {
        opened.sqlite.close();
      }
    });
  });
  it("keeps legacy model profiles while the catalog drives selection", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-test",
        });
        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash"]) },
          { clientSessionId: "bs_test" },
        );

        listModelDtos(options);
        const rows = opened.sqlite.prepare("SELECT id FROM model_profiles ORDER BY id").all() as {
          id: string;
        }[];
        expect(rows.map((row) => row.id)).toContain("deepseek-default");
        expect(getModelCatalog(options).models.map((model) => model.id)).toEqual([
          "deepseek-flash",
        ]);
      } finally {
        opened.sqlite.close();
      }
    });
  });
  it("binds a selection to an explicit credential when keys share a model", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        const first = createCredential(options, {
          provider: "deepseek",
          label: "First",
          apiKey: "sk-first",
        });
        createCredential(options, { provider: "deepseek", label: "Second", apiKey: "sk-second" });
        await refreshModelCatalog(
          { ...options, fetcher: async () => catalogResponse(["deepseek-flash"]) },
          { clientSessionId: "bs_test" },
        );

        expect(() => resolveCatalogSelection(options.db, { model: "deepseek-flash" })).toThrowError(
          ModelError,
        );

        expect(
          resolveCatalogSelection(options.db, {
            model: "deepseek-flash",
            credentialProfileId: first.id,
          }),
        ).toMatchObject({ model: "deepseek-flash", credentialProfileId: first.id });
      } finally {
        opened.sqlite.close();
      }
    });
  });
});
