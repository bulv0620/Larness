import { z } from "zod";
import { WebSearchError } from "./errors.js";
import { maxBytesFor, requestJson } from "./http.js";
import type {
  WebPage,
  WebPageRequest,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResult,
} from "./types.js";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_SEARCH_TIMEOUT_MS = 10_000;
export const DEEPSEEK_FETCH_TIMEOUT_MS = 20_000;

const SearchResponseSchema = z.object({
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
      summary: z.string().optional(),
      site_name: z.string().nullable().optional(),
      date: z.string().nullable().optional(),
      authority: z.number().int().optional(),
      rerank_score: z.number().optional(),
    }),
  ),
});

const FetchResponseSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  searchTimeoutMs?: number;
  fetchTimeoutMs?: number;
}

function headers(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  };
}

function baseUrl(value: string | undefined): string {
  return (value ?? DEEPSEEK_BASE_URL).replace(/\/$/, "");
}

export function createDeepSeekProvider(options: DeepSeekProviderOptions): WebSearchProvider {
  const endpoint = baseUrl(options.baseUrl);

  return {
    async search(input: WebSearchQuery): Promise<WebSearchResult[]> {
      const body = await requestJson(
        `${endpoint}/v1/tools/search`,
        {
          method: "POST",
          headers: headers(options.apiKey),
          body: JSON.stringify({
            query: input.query,
            count: input.count,
            need_content: false,
          }),
        },
        {
          operation: "search",
          timeoutMs: options.searchTimeoutMs ?? DEEPSEEK_SEARCH_TIMEOUT_MS,
          maxBytes: maxBytesFor("search"),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        },
      );
      const parsed = SearchResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new WebSearchError("WEB_SEARCH_FAILED", "invalid search response");
      }

      return parsed.data.results.map((item) => {
        const summary = item.summary ?? item.snippet ?? "";
        return {
          title: item.title,
          url: item.url,
          snippet: item.snippet ?? "",
          summary,
          ...(item.site_name === null || item.site_name === undefined
            ? {}
            : { siteName: item.site_name }),
          ...(item.date === null || item.date === undefined ? {} : { publishedAt: item.date }),
          ...(item.authority === undefined ? {} : { authority: item.authority }),
          ...(item.rerank_score === undefined ? {} : { rerankScore: item.rerank_score }),
        };
      });
    },

    async fetch(input: WebPageRequest): Promise<WebPage> {
      const body = await requestJson(
        `${endpoint}/v1/tools/fetch`,
        {
          method: "POST",
          headers: headers(options.apiKey),
          body: JSON.stringify({ url: input.url }),
        },
        {
          operation: "fetch",
          timeoutMs: options.fetchTimeoutMs ?? DEEPSEEK_FETCH_TIMEOUT_MS,
          maxBytes: maxBytesFor("fetch"),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        },
      );
      const parsed = FetchResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new WebSearchError("WEB_FETCH_FAILED", "invalid fetch response");
      }

      return { title: parsed.data.title, content: parsed.data.content };
    },
  };
}
