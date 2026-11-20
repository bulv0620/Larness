import type { ToolContext } from "@larness/agent";
import { describe, expect, it, vi } from "vitest";
import { createWebTools } from "../../src/modules/agent/webTool.js";
import { WebSearchError } from "../../src/modules/web-search/errors.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

function tool(name: "web_search" | "fetch_url") {
  const found = createWebTools().find((item) => item.name === name);
  if (found === undefined) throw new Error(`missing tool ${name}`);
  return found;
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return { projectRoot: "/tmp/project", ...overrides };
}

describe("web tools", () => {
  it("uses the agreed risk levels and stays project-independent", () => {
    expect(tool("web_search")).toMatchObject({
      riskLevel: "L0",
      requiresProject: false,
      requiresProjectLock: false,
    });
    expect(tool("fetch_url")).toMatchObject({
      riskLevel: "L1",
      requiresProject: false,
      requiresProjectLock: false,
    });
  });

  it("passes a valid search to the Turn handler", async () => {
    const webSearch = vi.fn(async () => ({ ok: true, summary: "2 results" }));
    const result = await tool("web_search").execute(
      { query: "latest release", count: 3 },
      context({ webSearch }),
    );

    expect(result).toEqual({ ok: true, summary: "2 results" });
    expect(webSearch).toHaveBeenCalledWith({ query: "latest release", count: 3 });
  });

  it("defaults count and fetches with offset defaults", async () => {
    const webSearch = vi.fn(async () => ({ ok: true, summary: "ok" }));
    const fetchUrl = vi.fn(async () => ({ ok: true, summary: "ok" }));

    await tool("web_search").execute({ query: "q" }, context({ webSearch }));
    await tool("fetch_url").execute({ url: "https://example.com" }, context({ fetchUrl }));

    expect(webSearch).toHaveBeenCalledWith({ query: "q", count: 5 });
    expect(fetchUrl).toHaveBeenCalledWith({
      url: "https://example.com",
      offset: 0,
      maxChars: 8_000,
    });
  });

  it("fails closed when the Turn did not bind the handler", async () => {
    expect(await tool("web_search").execute({ query: "q" }, context())).toMatchObject({
      ok: false,
      errorCode: "WEB_SEARCH_DISABLED",
    });
    expect(
      await tool("fetch_url").execute({ url: "https://example.com" }, context()),
    ).toMatchObject({ ok: false, errorCode: "WEB_SEARCH_DISABLED" });
  });

  it("blocks a query containing a configured credential", async () => {
    await withTempDir(async (dir) => {
      const store = await SecretStore.open(dir);
      const encrypted = store.encrypt("sk-live-secret");
      const webSearch = vi.fn(async () => ({ ok: true, summary: "should not run" }));
      const webTools = createWebTools({ secretStore: store });
      const search = webTools.find((item) => item.name === "web_search");
      if (search === undefined) throw new Error("missing search tool");

      const result = await search.execute(
        { query: "check sk-live-secret", count: 1 },
        context({ webSearch, loadSecrets: () => [encrypted] }),
      );

      expect(result).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
      expect(webSearch).not.toHaveBeenCalled();
    });
  });

  it("blocks private and local URLs before the handler", async () => {
    const fetchUrl = vi.fn(async () => ({ ok: true, summary: "should not run" }));

    for (const url of [
      "http://localhost:3210",
      "http://127.0.0.1",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
    ]) {
      const result = await tool("fetch_url").execute({ url }, context({ fetchUrl }));
      expect(result).toMatchObject({ ok: false, errorCode: "WEB_FETCH_BLOCKED" });
    }

    expect(fetchUrl).not.toHaveBeenCalled();
  });

  it("preserves a stable provider error code", async () => {
    const webSearch = vi.fn(async () => {
      throw new WebSearchError("WEB_SEARCH_AUTH_FAILED", "bad key");
    });

    expect(await tool("web_search").execute({ query: "q" }, context({ webSearch }))).toMatchObject({
      ok: false,
      errorCode: "WEB_SEARCH_AUTH_FAILED",
    });
  });

  it("rejects invalid arguments before the handler", async () => {
    const webSearch = vi.fn(async () => ({ ok: true, summary: "should not run" }));

    expect(
      await tool("web_search").execute({ query: "x", count: 99 }, context({ webSearch })),
    ).toMatchObject({ ok: false, errorCode: "VALIDATION_ERROR" });
    expect(webSearch).not.toHaveBeenCalled();
  });
});
