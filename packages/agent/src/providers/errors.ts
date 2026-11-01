export type ProviderErrorCode =
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_CONTEXT_LIMIT"
  | "PROVIDER_CONTENT_FILTERED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_UNKNOWN"
  | "PROVIDER_ABORTED";

const RETRYABLE: Record<ProviderErrorCode, boolean> = {
  PROVIDER_AUTH_FAILED: false,
  PROVIDER_RATE_LIMITED: true,
  PROVIDER_CONTEXT_LIMIT: false,
  PROVIDER_CONTENT_FILTERED: false,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_UNKNOWN: false,
  PROVIDER_ABORTED: false,
};

export interface ProviderErrorOptions {
  retryable?: boolean;
  statusCode?: number;
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(code: ProviderErrorCode, message: string, options: ProviderErrorOptions = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE[code];
    this.statusCode = options.statusCode;
  }
}

export function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  return name === "AbortError";
}

export function isTimeoutError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as { name?: unknown; message?: unknown };
  return (
    candidate.name === "TimeoutError" ||
    candidate.name === "HeadersTimeoutError" ||
    candidate.name === "BodyTimeoutError" ||
    (typeof candidate.message === "string" && /timed?\s*out/i.test(candidate.message))
  );
}
