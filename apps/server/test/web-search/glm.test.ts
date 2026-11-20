import { describe, expect, it } from "vitest";
import { createGlmProvider, GLM_SEARCH_REGIONS } from "../../src/modules/web-search/glm.js";

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

const searchBody = {
  id: "task-1",
  created: 1_790_000_000,
  search_result: [
    {
      title: "GLM 5.3 发布",
      link: "https://example.cn/glm",
      content: "这是一段与查询高度相关的正文摘要。",
      media: "示例媒体",
      publish_date: "2026-11-18",
      icon: "https://example.cn/icon.png",
      refer: "ref_1",
    },
  ],
};

describe("GLM web search provider", () => {
  it("uses the mainland endpoint and search_pro engine", async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse(searchBody);
    };
    const provider = createGlmProvider({ apiKey: "glm-test", region: "cn", fetchImpl });

    const results = await provider.search({ query: "GLM 5.3", count: 5 });

    expect(calls[0]?.url).toBe("https://open.bigmodel.cn/api/paas/v4/web_search");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      search_engine: "search_pro",
      search_query: "GLM 5.3",
      count: 5,
    });
    expect(calls[0]?.init.headers).toMatchObject({
      authorization: "Bearer glm-test",
      "content-type": "application/json",
    });
    expect(results).toEqual([
      {
        title: "GLM 5.3 发布",
        url: "https://example.cn/glm",
        snippet: "这是一段与查询高度相关的正文摘要。",
        summary: "这是一段与查询高度相关的正文摘要。",
        siteName: "示例媒体",
        publishedAt: "2026-11-18",
      },
    ]);
  });

  it("uses the international endpoint and search-prime engine", async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse(searchBody);
    };
    const provider = createGlmProvider({ apiKey: "glm-test", region: "global", fetchImpl });

    await provider.search({ query: "GLM 5.3", count: 5 });

    expect(calls[0]?.url).toBe("https://api.z.ai/api/paas/v4/web_search");
    expect(JSON.parse(String(calls[0]?.init.body)).search_engine).toBe("search-prime");
  });

  it("reads a page through the reader endpoint", async () => {
    const calls: CapturedCall[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return jsonResponse({
        reader_result: {
          title: "示例文章",
          url: "https://example.cn/article",
          content: "# 示例\n\n正文",
        },
      });
    };
    const provider = createGlmProvider({ apiKey: "glm-test", region: "cn", fetchImpl });

    const page = await provider.fetch({ url: "https://example.cn/article" });

    expect(calls[0]?.url).toBe("https://open.bigmodel.cn/api/paas/v4/reader");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      url: "https://example.cn/article",
      return_format: "markdown",
      retain_images: false,
    });
    expect(page).toEqual({ title: "示例文章", content: "# 示例\n\n正文" });
  });

  it("exposes only the supported regions", () => {
    expect(Object.keys(GLM_SEARCH_REGIONS)).toEqual(["cn", "global"]);
  });

  it("maps quota and rate-limit errors", async () => {
    const quota: typeof fetch = async () => jsonResponse({ error: { code: "1113" } }, 402);
    const limited: typeof fetch = async () => jsonResponse({ error: { code: "1701" } }, 429);
    const provider = createGlmProvider({ apiKey: "glm-test", region: "cn", fetchImpl: quota });

    await expect(provider.search({ query: "x", count: 1 })).rejects.toMatchObject({
      code: "WEB_SEARCH_QUOTA_EXCEEDED",
      retryable: false,
    });

    const retrying = createGlmProvider({
      apiKey: "glm-test",
      region: "cn",
      fetchImpl: limited,
    });
    await expect(retrying.search({ query: "x", count: 1 })).rejects.toMatchObject({
      code: "WEB_SEARCH_RATE_LIMITED",
      retryable: true,
    });
  });
});
