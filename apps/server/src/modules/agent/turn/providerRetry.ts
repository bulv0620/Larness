/**
 * Bounded retry policy for one model step.
 *
 * The AI SDK already retries 408/409/429/5xx and transport failures before the
 * stream starts, but a stream that dies after it started surfaces as an error
 * part, and `PROVIDER_UNKNOWN` is never retried there. This layer retries the
 * whole step only when it produced nothing visible: repeating a step that
 * already streamed text or a tool call would duplicate output, re-run tools and
 * bill the same tokens twice.
 */

/** First attempt plus two retries. */
export const PROVIDER_STEP_MAX_ATTEMPTS = 3;
export const PROVIDER_RETRY_BASE_DELAY_MS = 1_000;
/**
 * A step that already burned this long failed as a timeout or a very late
 * disconnect, not as a transient blip; retrying would spend another full
 * request window instead of recovering.
 */
export const PROVIDER_RETRY_MAX_ELAPSED_MS = 60_000;
/** Below this remaining Turn budget a retry cannot finish usefully. */
export const PROVIDER_RETRY_MIN_REMAINING_MS = 5_000;

export interface ProviderStepFailure {
  code: string;
  message: string;
  statusCode?: number;
}

export interface ProviderRetryInput {
  failure: ProviderStepFailure;
  /** Attempts already made for this step, including the one that failed. */
  attempts: number;
  /** True when any text, reasoning, tool call or usage part was produced. */
  emittedOutput: boolean;
  elapsedMs: number;
  remainingMs: number;
  maxAttempts?: number;
}

function retryableCode(failure: ProviderStepFailure): boolean {
  switch (failure.code) {
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_RATE_LIMITED":
      return true;
    case "PROVIDER_UNKNOWN":
      // No status code means the failure could not be fingerprinted at all;
      // a 4xx other than 408/409 is the request's fault and would repeat.
      return (
        failure.statusCode === undefined ||
        failure.statusCode === 408 ||
        failure.statusCode === 409 ||
        failure.statusCode >= 500
      );
    default:
      return false;
  }
}

export function shouldRetryProviderStep(input: ProviderRetryInput): boolean {
  if (input.emittedOutput) {
    return false;
  }

  if (input.attempts >= (input.maxAttempts ?? PROVIDER_STEP_MAX_ATTEMPTS)) {
    return false;
  }

  if (input.remainingMs <= PROVIDER_RETRY_MIN_REMAINING_MS) {
    return false;
  }

  if (input.elapsedMs > PROVIDER_RETRY_MAX_ELAPSED_MS) {
    return false;
  }

  return retryableCode(input.failure);
}

/** Exponential backoff: 1s, 2s for the two retries. */
export function providerRetryDelayMs(
  attempts: number,
  baseDelayMs: number = PROVIDER_RETRY_BASE_DELAY_MS,
): number {
  return baseDelayMs * 2 ** Math.max(0, attempts - 1);
}
