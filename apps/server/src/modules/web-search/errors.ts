export type WebSearchErrorCode =
  | "WEB_SEARCH_DISABLED"
  | "WEB_SEARCH_NOT_CONFIGURED"
  | "WEB_SEARCH_AUTH_FAILED"
  | "WEB_SEARCH_QUOTA_EXCEEDED"
  | "WEB_SEARCH_RATE_LIMITED"
  | "WEB_SEARCH_FAILED"
  | "WEB_SEARCH_LIMIT"
  | "WEB_FETCH_BLOCKED"
  | "WEB_FETCH_UNAVAILABLE"
  | "WEB_FETCH_FAILED"
  | "WEB_FETCH_LIMIT";

export class WebSearchError extends Error {
  readonly code: WebSearchErrorCode;
  /** Whether the service may retry once after a short backoff. */
  readonly retryable: boolean;
  readonly status?: number;

  constructor(code: WebSearchErrorCode, message: string, retryable = false, status?: number) {
    super(message);
    this.name = "WebSearchError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export type WebSearchOperation = "search" | "fetch";

/**
 * Maps an upstream HTTP status to a stable tool error. The upstream body is
 * never included: it can contain provider internals or secret-shaped text.
 */
export function mapHttpStatus(status: number, operation: WebSearchOperation): WebSearchError {
  if (status === 401) {
    return new WebSearchError(
      "WEB_SEARCH_AUTH_FAILED",
      "search credential is invalid or expired",
      false,
      status,
    );
  }

  if (status === 402) {
    return new WebSearchError(
      "WEB_SEARCH_QUOTA_EXCEEDED",
      "search account has insufficient balance",
      false,
      status,
    );
  }

  if (status === 403) {
    return operation === "fetch"
      ? new WebSearchError("WEB_FETCH_BLOCKED", "the page is not allowed to be read", false, status)
      : new WebSearchError("WEB_SEARCH_FAILED", "the search request was rejected", false, status);
  }

  if (status === 404) {
    return operation === "fetch"
      ? new WebSearchError(
          "WEB_FETCH_UNAVAILABLE",
          "the page could not be retrieved",
          false,
          status,
        )
      : new WebSearchError(
          "WEB_SEARCH_FAILED",
          "the search endpoint is unavailable",
          false,
          status,
        );
  }

  if (status === 408) {
    return operation === "fetch"
      ? new WebSearchError("WEB_FETCH_FAILED", "the page request timed out", true, status)
      : new WebSearchError("WEB_SEARCH_FAILED", "the search request timed out", true, status);
  }

  if (status === 429) {
    return operation === "fetch"
      ? new WebSearchError("WEB_FETCH_FAILED", "the page request was rate limited", true, status)
      : new WebSearchError(
          "WEB_SEARCH_RATE_LIMITED",
          "the search request was rate limited",
          true,
          status,
        );
  }

  if (status >= 500) {
    return operation === "fetch"
      ? new WebSearchError("WEB_FETCH_FAILED", "the page service is unavailable", true, status)
      : new WebSearchError("WEB_SEARCH_FAILED", "the search service is unavailable", true, status);
  }

  return operation === "fetch"
    ? new WebSearchError("WEB_FETCH_FAILED", "the page request failed", false, status)
    : new WebSearchError("WEB_SEARCH_FAILED", "the search request failed", false, status);
}
