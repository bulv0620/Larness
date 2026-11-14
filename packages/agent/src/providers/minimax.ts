import { z } from "zod";
import { ProviderError, type ProviderErrorCode } from "./errors.js";

const envelope = z.object({ base_resp: z.object({ status_code: z.number() }) });
const errorCodes: Record<number, ProviderErrorCode> = {
  1002: "PROVIDER_RATE_LIMITED",
  1004: "PROVIDER_AUTH_FAILED",
  1008: "PROVIDER_QUOTA_EXHAUSTED",
  1026: "PROVIDER_CONTENT_FILTERED",
};

function checkBusinessError(data: string): void {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }
  const result = envelope.safeParse(payload);
  if (result.success && result.data.base_resp.status_code !== 0) {
    throw new ProviderError(
      errorCodes[result.data.base_resp.status_code] ?? "PROVIDER_UNKNOWN",
      "MiniMax rejected the request",
    );
  }
}

export const miniMaxFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, { ...init, redirect: "error" });
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    checkBusinessError(await response.clone().text());
    return response;
  }
  if (!response.body || !contentType.includes("text/event-stream")) return response;
  let pending = "";
  const decoder = new TextDecoder();
  const inspect = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (pending.length > 1024 * 1024)
        throw new ProviderError("PROVIDER_UNKNOWN", "MiniMax stream event is too large");
      for (const line of lines) {
        if (line.startsWith("data:")) checkBusinessError(line.slice(5).trim());
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (pending.startsWith("data:")) checkBusinessError(pending.slice(5).trim());
    },
  });
  return new Response(response.body.pipeThrough(inspect), response);
};

export function miniMaxRequest(body: Record<string, unknown>): Record<string, unknown> {
  const { max_tokens, ...request } = body;
  return {
    ...request,
    ...(max_tokens === undefined ? {} : { max_completion_tokens: max_tokens }),
    reasoning_split: true,
  };
}
