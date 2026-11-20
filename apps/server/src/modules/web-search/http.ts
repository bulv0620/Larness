import { mapHttpStatus, WebSearchError, type WebSearchOperation } from "./errors.js";

export interface RequestJsonOptions {
  operation: WebSearchOperation;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_SEARCH_BYTES = 1_048_576;
const DEFAULT_MAX_FETCH_BYTES = 4_194_304;

export function maxBytesFor(operation: WebSearchOperation): number {
  return operation === "fetch" ? DEFAULT_MAX_FETCH_BYTES : DEFAULT_MAX_SEARCH_BYTES;
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  operation: WebSearchOperation,
): Promise<string> {
  const body = response.body;

  if (body === null) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new WebSearchError(
        operation === "fetch" ? "WEB_FETCH_FAILED" : "WEB_SEARCH_FAILED",
        "upstream response is too large",
      );
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebSearchError(
        operation === "fetch" ? "WEB_FETCH_FAILED" : "WEB_SEARCH_FAILED",
        "upstream response is too large",
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function abortError(operation: WebSearchOperation, cancelled: boolean): WebSearchError {
  const code = operation === "fetch" ? "WEB_FETCH_FAILED" : "WEB_SEARCH_FAILED";
  return new WebSearchError(
    code,
    cancelled ? "request cancelled" : "request timed out",
    !cancelled,
  );
}

/**
 * JSON request with a hard timeout and a byte ceiling. Redirects are rejected so
 * a provider cannot forward the bearer key to another host.
 */
export async function requestJson(
  url: string,
  init: RequestInit,
  options: RequestJsonOptions,
): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let cancelled = false;

  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted === true) onAbort();

  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw mapHttpStatus(response.status, options.operation);
    }

    const text = await readBoundedText(response, options.maxBytes, options.operation);

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new WebSearchError(
        options.operation === "fetch" ? "WEB_FETCH_FAILED" : "WEB_SEARCH_FAILED",
        "upstream returned invalid JSON",
      );
    }
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    if (controller.signal.aborted) throw abortError(options.operation, cancelled);
    throw new WebSearchError(
      options.operation === "fetch" ? "WEB_FETCH_FAILED" : "WEB_SEARCH_FAILED",
      "upstream request failed",
      true,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
