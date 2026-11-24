import { describe, expect, it } from "vitest";
import {
  PROVIDER_RETRY_BASE_DELAY_MS,
  PROVIDER_RETRY_MAX_ELAPSED_MS,
  PROVIDER_STEP_MAX_ATTEMPTS,
  providerRetryDelayMs,
  shouldRetryProviderStep,
} from "../../src/modules/agent/turn/providerRetry.js";

const base = {
  attempts: 1,
  emittedOutput: false,
  elapsedMs: 1_500,
  remainingMs: 600_000,
};

describe("shouldRetryProviderStep", () => {
  it("retries transient failures while the step produced nothing", () => {
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: {
          code: "PROVIDER_UNAVAILABLE",
          message: "provider is unavailable",
          statusCode: 502,
        },
      }),
    ).toBe(true);
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: { code: "PROVIDER_RATE_LIMITED", message: "rate limited", statusCode: 429 },
      }),
    ).toBe(true);
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: { code: "PROVIDER_UNKNOWN", message: "provider request failed" },
      }),
    ).toBe(true);
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: { code: "PROVIDER_UNKNOWN", message: "provider request failed", statusCode: 503 },
      }),
    ).toBe(true);
  });

  it("never retries terminal or client-side failures", () => {
    for (const code of [
      "PROVIDER_AUTH_FAILED",
      "PROVIDER_QUOTA_EXHAUSTED",
      "PROVIDER_CONTEXT_LIMIT",
      "PROVIDER_CONTENT_FILTERED",
      "PROVIDER_ABORTED",
    ]) {
      expect(shouldRetryProviderStep({ ...base, failure: { code, message: "terminal" } })).toBe(
        false,
      );
    }

    // A 4xx that could not be classified would repeat pointlessly.
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: { code: "PROVIDER_UNKNOWN", message: "provider request failed", statusCode: 400 },
      }),
    ).toBe(false);
    expect(
      shouldRetryProviderStep({
        ...base,
        failure: { code: "PROVIDER_UNKNOWN", message: "provider request failed", statusCode: 404 },
      }),
    ).toBe(false);
  });

  it("stops when output, attempt budget, elapsed time or remaining budget says no", () => {
    const failure = { code: "PROVIDER_UNAVAILABLE", message: "provider is unavailable" };

    expect(shouldRetryProviderStep({ ...base, failure, emittedOutput: true })).toBe(false);
    expect(
      shouldRetryProviderStep({ ...base, failure, attempts: PROVIDER_STEP_MAX_ATTEMPTS }),
    ).toBe(false);
    expect(
      shouldRetryProviderStep({
        ...base,
        failure,
        elapsedMs: PROVIDER_RETRY_MAX_ELAPSED_MS + 1,
      }),
    ).toBe(false);
    expect(shouldRetryProviderStep({ ...base, failure, remainingMs: 1_000 })).toBe(false);
  });
});

describe("providerRetryDelayMs", () => {
  it("backs off exponentially from the base delay", () => {
    expect(providerRetryDelayMs(1)).toBe(PROVIDER_RETRY_BASE_DELAY_MS);
    expect(providerRetryDelayMs(2)).toBe(PROVIDER_RETRY_BASE_DELAY_MS * 2);
    expect(providerRetryDelayMs(1, 0)).toBe(0);
  });
});
