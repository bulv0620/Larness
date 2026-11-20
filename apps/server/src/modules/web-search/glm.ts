import { GLM_ENDPOINTS } from "@larness/agent";
import { z } from "zod";
import { WebSearchError } from "./errors.js";
import { maxBytesFor, requestJson } from "./http.js";
import type {
  WebPage,
  WebPageRequest,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchRegion,
  WebSearchResult,
} from "./types.js";

export const GLM_SEARCH_REGIONS = {
  cn: {
    baseUrl: GLM_ENDPOINTS.standardCn,
    engine: "search_pro",
  },
  global: {
    baseUrl: GLM_ENDPOINTS.standardIntl,
    engine: "search-prime",
  },
} as const satisfies Record<WebSearchRegion, { baseUrl: string; engine: string }>;

const GLM_SEARCH_TIMEOUT_MS = 10_000;
const GLM_FETCH_TIMEOUT_MS = 20_000;

const SearchResponseSchema = z.object({
  search_result: z.array(
    z.object({
      title: z.string(),
      link: z.string(),
      content: z.string().optional(),
      media: z.string().nullable().optional(),
      publish_date: z.string().nullable().optional(),
      icon: z.string().nullable().optional(),
      refer: z.string().optional(),
    }),
  ),
});

const ReaderResponseSchema = z.object({
  reader_result: z.object({
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
  }),
});

export interface GlmProviderOptions {
  apiKey: string;
  region: WebSearchRegion;
  baseUrl?: string;
  engine?: string;
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

function snippetOf(content: string): string {
  return content.length <= 200 ? content : `${content.slice(0, 200).trimEnd()}…`;
}

export function createGlmProvider(options: GlmProviderOptions): WebSearchProvider {
  const preset = GLM_SEARCH_REGIONS[options.region];
  const endpoint = (options.baseUrl ?? preset.baseUrl).replace(/\/$/, "");
  const engine = options.engine ?? preset.engine;

  return {
    async search(input: WebSearchQuery): Promise<WebSearchResult[]> {
      const body = await requestJson(
        `${endpoint}/web_search`,
        {
          method: "POST",
          headers: headers(options.apiKey),
          body: JSON.stringify({
            search_engine: engine,
            search_query: input.query,
            count: input.count,
          }),
        },
        {
          operation: "search",
          timeoutMs: options.searchTimeoutMs ?? GLM_SEARCH_TIMEOUT_MS,
          maxBytes: maxBytesFor("search"),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        },
      );
      const parsed = SearchResponseSchema.safeParse(body);

      if (!parsed.success) {
        throw new WebSearchError("WEB_SEARCH_FAILED", "invalid search response");
      }

      return parsed.data.search_result.map((item) => {
        const summary = item.content ?? "";
        return {
          title: item.title,
          url: item.link,
          snippet: snippetOf(summary),
          summary,
          ...(item.media === null || item.media === undefined ? {} : { siteName: item.media }),
          ...(item.publish_date === null || item.publish_date === undefined
            ? {}
            : { publishedAt: item.publish_date }),
        };
      });
    },

    async fetch(input: WebPageRequest): Promise<WebPage> {
      const body = await requestJson(
        `${endpoint}/reader`,
        {
          method: "POST",
          headers: headers(options.apiKey),
          body: JSON.stringify({
            url: input.url,
            return_format: "markdown",
            retain_images: false,
          }),
        },
        {
          operation: "fetch",
          timeoutMs: options.fetchTimeoutMs ?? GLM_FETCH_TIMEOUT_MS,
          maxBytes: maxBytesFor("fetch"),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
        },
      );
      const parsed = ReaderResponseSchema.safeParse(body);

      if (!parsed.success || parsed.data.reader_result.content === undefined) {
        throw new WebSearchError("WEB_FETCH_FAILED", "invalid fetch response");
      }

      return {
        title: parsed.data.reader_result.title ?? "",
        content: parsed.data.reader_result.content,
      };
    },
  };
}
