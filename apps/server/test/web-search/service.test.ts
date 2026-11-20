import { describe, expect, it, vi } from "vitest";
import { WebSearchError } from "../../src/modules/web-search/errors.js";
import { WebSearchService } from "../../src/modules/web-search/service.js";
import type { WebSearchProvider } from "../../src/modules/web-search/types.js";

const connection = {
  id: "wsc_test",
  provider: "deepseek" as const,
  region: null,
  endpoint: "https://api.deepseek.com",
};

function provider(overrides: Partial<WebSearchProvider> = {}): WebSearchProvider {
  return {
    search: vi.fn(async () => [
      {
        title: "t",
        url: "https://example.com",
        snippet: "s",
        summary: "summary",
      },
    ]),
    fetch: vi.fn(async () => ({ title: "page", content: "body" })),
    ...overrides,
  };
}

describe("WebSearchService", () => {
  it("retries a retryable failure once and then succeeds", async () => {
    let attempts = 0;
    const fake = provider({
      search: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new WebSearchError("WEB_SEARCH_RATE_LIMITED", "busy", true);
        }
        return [{ title: "ok", url: "https://example.com", snippet: "s", summary: "m" }];
      },
    });
    const sleep = vi.fn(async () => undefined);
    const service = new WebSearchService({
      providerFactory: () => fake,
      sleep,
      retryDelayMs: 10,
    });

    const results = await service.search(connection, "key", { query: "q", count: 2 });

    expect(attempts).toBe(2);
    expect(sleep).toHaveBeenCalledWith(10);
    expect(results).toHaveLength(1);
  });

  it("does not retry a non-retryable failure", async () => {
    const search = vi.fn(async () => {
      throw new WebSearchError("WEB_SEARCH_AUTH_FAILED", "bad key", false);
    });
    const service = new WebSearchService({ providerFactory: () => provider({ search }) });

    await expect(service.search(connection, "key", { query: "q", count: 2 })).rejects.toMatchObject(
      { code: "WEB_SEARCH_AUTH_FAILED" },
    );
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("stops after the second retryable failure", async () => {
    const search = vi.fn(async () => {
      throw new WebSearchError("WEB_FETCH_FAILED", "down", true);
    });
    const service = new WebSearchService({
      providerFactory: () => provider({ search }),
      sleep: async () => undefined,
    });

    await expect(service.search(connection, "key", { query: "q", count: 2 })).rejects.toMatchObject(
      { code: "WEB_FETCH_FAILED" },
    );
    expect(search).toHaveBeenCalledTimes(2);
  });

  it("passes the provider and key to the factory and returns the page", async () => {
    const fetch = vi.fn(async () => ({ title: "t", content: "c" }));
    const factory = vi.fn(() => provider({ fetch }));
    const service = new WebSearchService({ providerFactory: factory });

    const page = await service.fetchPage(connection, "secret", { url: "https://example.com" });

    expect(factory).toHaveBeenCalledWith(connection, "secret");
    expect(page).toEqual({ title: "t", content: "c" });
  });

  it("reports latency and result count for a connection test", async () => {
    const service = new WebSearchService({
      providerFactory: () => provider(),
      now: () => 1_000,
    });

    const result = await service.testConnection(connection, "key");

    expect(result).toEqual({ latencyMs: 0, resultCount: 1 });
  });
});
