import { createDeepSeekProvider } from "./deepseek.js";
import { WebSearchError } from "./errors.js";
import { createGlmProvider } from "./glm.js";
import type {
  ConnectionTestResult,
  WebPage,
  WebPageRequest,
  WebSearchConnectionRef,
  WebSearchProvider,
  WebSearchQuery,
  WebSearchResult,
} from "./types.js";

export type WebSearchProviderFactory = (
  connection: WebSearchConnectionRef,
  apiKey: string,
) => WebSearchProvider;

export interface WebSearchServiceOptions {
  fetchImpl?: typeof fetch;
  providerFactory?: WebSearchProviderFactory;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export function createProvider(
  connection: WebSearchConnectionRef,
  apiKey: string,
  fetchImpl?: typeof fetch,
): WebSearchProvider {
  if (connection.provider === "deepseek") {
    return createDeepSeekProvider({
      apiKey,
      baseUrl: connection.endpoint,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
  }

  if (connection.provider === "glm") {
    return createGlmProvider({
      apiKey,
      region: connection.region ?? "cn",
      baseUrl: connection.endpoint,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
  }

  throw new WebSearchError("WEB_SEARCH_NOT_CONFIGURED", "unsupported search provider");
}

export class WebSearchService {
  readonly #options: Required<Pick<WebSearchServiceOptions, "retryDelayMs" | "sleep" | "now">> &
    WebSearchServiceOptions;

  constructor(options: WebSearchServiceOptions = {}) {
    this.#options = {
      retryDelayMs: options.retryDelayMs ?? 300,
      sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: options.now ?? (() => Date.now()),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.providerFactory === undefined
        ? {}
        : { providerFactory: options.providerFactory }),
    };
  }

  #provider(connection: WebSearchConnectionRef, apiKey: string): WebSearchProvider {
    return (
      this.#options.providerFactory?.(connection, apiKey) ??
      createProvider(connection, apiKey, this.#options.fetchImpl)
    );
  }

  async #retry<T>(call: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await call();
      } catch (error) {
        lastError = error;
        if (!(error instanceof WebSearchError) || !error.retryable || attempt === 1) {
          throw error;
        }
        await this.#options.sleep(this.#options.retryDelayMs);
      }
    }

    throw lastError;
  }

  async search(
    connection: WebSearchConnectionRef,
    apiKey: string,
    input: WebSearchQuery,
  ): Promise<WebSearchResult[]> {
    const provider = this.#provider(connection, apiKey);
    return this.#retry(() => provider.search(input));
  }

  async fetchPage(
    connection: WebSearchConnectionRef,
    apiKey: string,
    input: WebPageRequest,
  ): Promise<WebPage> {
    const provider = this.#provider(connection, apiKey);
    return this.#retry(() => provider.fetch(input));
  }

  async testConnection(
    connection: WebSearchConnectionRef,
    apiKey: string,
  ): Promise<ConnectionTestResult> {
    const startedAt = this.#options.now();
    const results = await this.search(connection, apiKey, { query: "Larness", count: 1 });
    return {
      latencyMs: Math.max(0, this.#options.now() - startedAt),
      resultCount: results.length,
    };
  }
}
