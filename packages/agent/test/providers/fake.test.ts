import { describe, expect, it } from "vitest";
import {
  createFakeProvider,
  type ProviderChunk,
  ProviderError,
  type ProviderStepInput,
} from "../../src/providers/index.js";

function stepInput(signal = new AbortController().signal): ProviderStepInput {
  return {
    model: "fake",
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    signal,
  };
}

async function collect(iterable: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

describe("FakeProvider", () => {
  it("replays a scripted text and tool-call stream deterministically", async () => {
    const script: ProviderChunk[][] = [
      [{ type: "text-delta", text: "Hello" }],
      [
        {
          type: "tool-call",
          toolCall: { id: "call_1", name: "read_file", args: { path: "README.md" } },
        },
        {
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        },
      ],
    ];
    const provider = createFakeProvider(script.map((chunks) => ({ chunks })));

    expect(await collect(provider.streamStep(stepInput()))).toEqual(script[0]);
    expect(await collect(provider.streamStep(stepInput()))).toEqual(script[1]);
    expect(provider.calls.map((call) => call.model)).toEqual(["fake", "fake"]);
    expect(provider.capabilities).toMatchObject({
      streaming: true,
      toolCalls: true,
      maxContextTokens: 128_000,
    });
  });

  it("returns PROVIDER_UNAVAILABLE when the script is exhausted", async () => {
    const provider = createFakeProvider([]);
    const chunks = await collect(provider.streamStep(stepInput()));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_UNAVAILABLE", retryable: true },
    });
  });

  it("stops at an injected error chunk", async () => {
    const provider = createFakeProvider([
      {
        chunks: [
          { type: "text-delta", text: "partial" },
          {
            type: "error",
            error: new ProviderError("PROVIDER_RATE_LIMITED", "rate limited"),
          },
          { type: "finish", finishReason: "stop" },
        ],
      },
    ]);

    const chunks = await collect(provider.streamStep(stepInput()));
    expect(chunks.map((chunk) => chunk.type)).toEqual(["text-delta", "error"]);
  });

  it("returns PROVIDER_ABORTED when the signal aborts during a delay", async () => {
    const controller = new AbortController();
    const provider = createFakeProvider([
      { delayMs: 1_000, chunks: [{ type: "text-delta", text: "late" }] },
    ]);
    const iterator = provider.streamStep(stepInput(controller.signal));

    const pending = collect(iterator);
    setTimeout(() => controller.abort(), 5);

    const chunks = await pending;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_ABORTED", retryable: false },
    });
  });

  it("honours capability overrides", () => {
    const provider = createFakeProvider([], {
      capabilities: { vision: true, maxContextTokens: 4_096 },
    });

    expect(provider.capabilities).toMatchObject({
      vision: true,
      maxContextTokens: 4_096,
      toolCalls: true,
    });
  });
});
