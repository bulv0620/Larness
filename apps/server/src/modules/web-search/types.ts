export type WebSearchProviderId = "deepseek" | "glm";

export type WebSearchRegion = "cn" | "global";

/** A resolved search connection. The secret is passed separately by the service. */
export interface WebSearchConnectionRef {
  id: string;
  provider: WebSearchProviderId;
  region: WebSearchRegion | null;
  /** Full API base prefix, selected from a fixed provider/region preset. */
  endpoint: string;
}

export interface WebSearchQuery {
  query: string;
  count: number;
  signal?: AbortSignal;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName?: string;
  publishedAt?: string;
  authority?: number;
  rerankScore?: number;
}

export interface WebPage {
  title: string;
  content: string;
}

export interface WebPageRequest {
  url: string;
  signal?: AbortSignal;
}

export interface WebSearchProvider {
  search(input: WebSearchQuery): Promise<WebSearchResult[]>;
  fetch(input: WebPageRequest): Promise<WebPage>;
}

export interface ConnectionTestResult {
  latencyMs: number;
  resultCount: number;
}
