import { ProviderError } from "./errors.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderChunk,
  ProviderStepInput,
} from "./types.js";

export interface FakeProviderStep {
  chunks: ProviderChunk[];
  delayMs?: number;
}

export interface FakeProviderOptions {
  capabilities?: Partial<ProviderCapabilities>;
  defaultDelayMs?: number;
}

export interface FakeProvider extends ProviderAdapter {
  readonly calls: ProviderStepInput[];
}

export const FAKE_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalls: true,
  vision: false,
  reasoning: false,
  maxContextTokens: 128_000,
};

function abortedChunk(): ProviderChunk {
  return {
    type: "error",
    error: new ProviderError("PROVIDER_ABORTED", "provider request aborted"),
  };
}

function waitForDelay(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function createFakeProvider(
  script: FakeProviderStep[],
  options: FakeProviderOptions = {},
): FakeProvider {
  const calls: ProviderStepInput[] = [];
  let cursor = 0;

  return {
    id: "fake",
    capabilities: { ...FAKE_CAPABILITIES, ...options.capabilities },
    calls,
    async *streamStep(input: ProviderStepInput): AsyncGenerator<ProviderChunk> {
      // Snapshot the request: the runner mutates its message array in place,
      // so a stored reference would make every recorded call look identical.
      calls.push({ ...input, messages: [...input.messages], tools: [...input.tools] });
      const step = script[cursor];
      cursor += 1;

      if (step === undefined) {
        yield {
          type: "error",
          error: new ProviderError("PROVIDER_UNAVAILABLE", "fake provider script is exhausted"),
        };
        return;
      }

      const delayMs = step.delayMs ?? options.defaultDelayMs ?? 0;

      if (delayMs > 0 && !(await waitForDelay(delayMs, input.signal))) {
        yield abortedChunk();
        return;
      }

      for (const chunk of step.chunks) {
        if (input.signal.aborted) {
          yield abortedChunk();
          return;
        }

        yield chunk;

        if (chunk.type === "error") {
          return;
        }
      }
    },
  };
}
