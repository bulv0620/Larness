import { describe, expect, it } from "vitest";
import { createDeepSeekProvider } from "../../src/modules/web-search/deepseek.js";

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DeepSeek web search provider", () => {
  it("sends a bounded search request with the bearer key", async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({
        results: [
          {
            rerank_score: 2.4,
            title: "DeepSeek V4 release",
            url: "https://example.com/deepseek-v4",
            snippet: "DeepSeek V4 is available.",
            summary: "A longer summary about the release.",
            content: "Full page content is not requested.",
            site_name: "Example",
            site_icon: "https://example.com/icon.png",
            date: "2026-11-13T00:00:00+00:00",
            authority: 3,
          },
        ],
      });
    };
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    const results = await provider.search({ query: "DeepSeek V4", count: 5 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/tools/search");
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer sk-test",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      query: "DeepSeek V4",
      count: 5,
      need_content: false,
    });
    expect(results).toEqual([
      {
        title: "DeepSeek V4 release",
        url: "https://example.com/deepseek-v4",
        snippet: "DeepSeek V4 is available.",
        summary: "A longer summary about the release.",
        siteName: "Example",
        publishedAt: "2026-11-13T00:00:00+00:00",
        authority: 3,
        rerankScore: 2.4,
      },
    ]);
  });

  it("fetches a page as markdown", async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({ title: "Example article", content: "# Example\n\nBody" });
    };
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    const page = await provider.fetch({ url: "https://example.com/article" });

    expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/tools/fetch");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      url: "https://example.com/article",
    });
    expect(page).toEqual({ title: "Example article", content: "# Example\n\nBody" });
  });

  it.each([
    [401, "WEB_SEARCH_AUTH_FAILED", false],
    [402, "WEB_SEARCH_QUOTA_EXCEEDED", false],
    [403, "WEB_SEARCH_FAILED", false],
    [404, "WEB_SEARCH_FAILED", false],
    [408, "WEB_SEARCH_FAILED", true],
    [429, "WEB_SEARCH_RATE_LIMITED", true],
    [500, "WEB_SEARCH_FAILED", true],
    [503, "WEB_SEARCH_FAILED", true],
  ])("maps search HTTP %i to %s", async (status, code, retryable) => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: { message: "upstream detail must not leak" } }, status);
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    await expect(provider.search({ query: "x", count: 1 })).rejects.toMatchObject({
      code,
      retryable,
    });
  });

  it.each([
    [401, "WEB_SEARCH_AUTH_FAILED", false],
    [403, "WEB_FETCH_BLOCKED", false],
    [404, "WEB_FETCH_UNAVAILABLE", false],
    [429, "WEB_FETCH_FAILED", true],
    [504, "WEB_FETCH_FAILED", true],
  ])("maps fetch HTTP %i to %s", async (status, code, retryable) => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: "nope" }, status);
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    await expect(provider.fetch({ url: "https://example.com" })).rejects.toMatchObject({
      code,
      retryable,
    });
  });

  it("fails closed on an invalid upstream body without leaking it", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("not-json-secret-ish", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const provider = createDeepSeekProvider({ apiKey: "sk-test", fetchImpl });

    await expect(provider.search({ query: "x", count: 1 })).rejects.toMatchObject({
      code: "WEB_SEARCH_FAILED",
    });
  });
});
