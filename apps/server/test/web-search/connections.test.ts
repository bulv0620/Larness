import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { getMeta, setMeta } from "../../src/db/repositories/meta.js";
import {
  createWebSearchConnection,
  deleteWebSearchConnection,
  listWebSearchConnections,
  resolveActiveWebSearchConnection,
  resolveWebSearchConnection,
  updateWebSearchConnection,
  WebSearchConfigError,
} from "../../src/modules/web-search/connections.js";
import {
  DEFAULT_WEB_SEARCH_SETTINGS,
  getWebSearchSettings,
  setWebSearchSettings,
  WEB_SEARCH_SETTINGS_KEY,
} from "../../src/modules/web-search/settings.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

async function fixture(dir: string): Promise<{
  opened: OpenedDatabase;
  store: SecretStore;
  options: { db: OpenedDatabase["db"]; secretStore: SecretStore; now: () => number };
}> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const store = await SecretStore.open(dir);
  return {
    opened,
    store,
    options: { db: opened.db, secretStore: store, now: () => 1_000 },
  };
}

function secretCount(opened: OpenedDatabase): number {
  return (opened.sqlite.prepare("SELECT count(*) AS count FROM secrets").get() as { count: number })
    .count;
}

describe("web search storage", () => {
  it("adds the connection table and default-off session/turn columns", async () => {
    await withTempDir(async (dir) => {
      const { opened } = await fixture(dir);
      try {
        const tables = opened.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all() as { name: string }[];
        expect(tables.map((row) => row.name)).toContain("web_search_connections");

        const sessionColumns = opened.sqlite.prepare("PRAGMA table_info(sessions)").all() as {
          name: string;
          dflt_value: string | null;
        }[];
        const turnColumns = opened.sqlite.prepare("PRAGMA table_info(turns)").all() as {
          name: string;
          dflt_value: string | null;
        }[];
        expect(sessionColumns.find((column) => column.name === "web_search_enabled")).toMatchObject(
          {
            dflt_value: "false",
          },
        );
        expect(turnColumns.find((column) => column.name === "web_search_enabled")).toMatchObject({
          dflt_value: "false",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("creates a DeepSeek connection, masks the key, and resolves it", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        const created = createWebSearchConnection(options, {
          provider: "deepseek",
          label: "DeepSeek 搜索",
          apiKey: "sk-search-secret",
        });

        expect(created).toMatchObject({
          provider: "deepseek",
          label: "DeepSeek 搜索",
          region: null,
          endpoint: "https://api.deepseek.com",
          maskedKey: "••••••",
        });
        expect(JSON.stringify(created)).not.toContain("sk-search-secret");
        expect(getWebSearchSettings(options.db).activeConnectionId).toBe(created.id);

        const resolved = resolveActiveWebSearchConnection(options);
        expect(resolved?.apiKey).toBe("sk-search-secret");
        expect(resolved?.connection.id).toBe(created.id);
        expect(secretCount(opened)).toBe(1);
      } finally {
        opened.close();
      }
    });
  });

  it("defaults GLM to the mainland endpoint and supports the global region", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        const cn = createWebSearchConnection(options, {
          provider: "glm",
          label: "GLM 国内",
          apiKey: "glm-cn",
        });
        const global = createWebSearchConnection(options, {
          provider: "glm",
          label: "GLM 国际",
          apiKey: "glm-global",
          region: "global",
        });

        expect(cn.endpoint).toBe("https://open.bigmodel.cn/api/paas/v4");
        expect(global.endpoint).toBe("https://api.z.ai/api/paas/v4");
        expect(listWebSearchConnections(options.db)).toHaveLength(2);
      } finally {
        opened.close();
      }
    });
  });

  it("rotates the key and removes the old secret", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        const created = createWebSearchConnection(options, {
          provider: "deepseek",
          label: "Search",
          apiKey: "old-key",
        });
        expect(secretCount(opened)).toBe(1);

        updateWebSearchConnection(options, {
          id: created.id,
          apiKey: "new-key",
          label: "Search updated",
        });

        expect(secretCount(opened)).toBe(1);
        expect(resolveWebSearchConnection(options, created.id).apiKey).toBe("new-key");
        expect(listWebSearchConnections(options.db)[0]?.label).toBe("Search updated");
      } finally {
        opened.close();
      }
    });
  });

  it("deletes the connection and its secret without touching model credentials", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        const created = createWebSearchConnection(options, {
          provider: "deepseek",
          label: "Search",
          apiKey: "search-key",
        });
        deleteWebSearchConnection(options, created.id);

        expect(listWebSearchConnections(options.db)).toEqual([]);
        expect(secretCount(opened)).toBe(0);
        expect(getWebSearchSettings(options.db).activeConnectionId).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("rejects an invalid region for DeepSeek", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        expect(() =>
          createWebSearchConnection(options, {
            provider: "deepseek",
            label: "Search",
            apiKey: "key",
            region: "cn",
          }),
        ).toThrowError(WebSearchConfigError);
      } finally {
        opened.close();
      }
    });
  });
});

describe("web search settings", () => {
  it("falls back to defaults for missing or corrupt metadata", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        expect(getWebSearchSettings(options.db)).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);

        setMeta(options.db, WEB_SEARCH_SETTINGS_KEY, "not-json", 1);
        expect(getWebSearchSettings(options.db)).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);

        setMeta(
          options.db,
          WEB_SEARCH_SETTINGS_KEY,
          JSON.stringify({ ...DEFAULT_WEB_SEARCH_SETTINGS, maxResults: 99 }),
          1,
        );
        expect(getWebSearchSettings(options.db)).toEqual(DEFAULT_WEB_SEARCH_SETTINGS);
      } finally {
        opened.close();
      }
    });
  });

  it("persists the active connection and immutable limits", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);
      try {
        setWebSearchSettings(options.db, {
          version: 1,
          activeConnectionId: null,
          maxResults: 8,
          maxSearchesPerTurn: 3,
          maxFetchesPerTurn: 2,
        });
        expect(getWebSearchSettings(options.db)).toMatchObject({
          maxResults: 8,
          maxSearchesPerTurn: 3,
          maxFetchesPerTurn: 2,
        });
        expect(getMeta(options.db, WEB_SEARCH_SETTINGS_KEY)).toContain('"maxResults":8');
      } finally {
        opened.close();
      }
    });
  });
});
