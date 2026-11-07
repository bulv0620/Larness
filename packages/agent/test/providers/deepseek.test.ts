import { APICallError, RetryError } from "ai";
import { describe, expect, it } from "vitest";
import {
  classifyProviderError,
  createDeepSeekProvider,
  createFakeProvider,
  DEEPSEEK_DEFAULT_MODEL,
  mapAiSdkStream,
  type ProviderChunk,
  type ProviderStepInput,
  toAiSdkMessages,
  toAiSdkTools,
  toDeepSeekProviderOptions,
} from "../../src/providers/index.js";

function apiError(statusCode: number, message: string, responseBody?: string): APICallError {
  return new APICallError({
    message,
    url: "https://api.deepseek.com/chat/completions",
    requestBodyValues: {},
    statusCode,
    ...(responseBody === undefined ? {} : { responseBody }),
    isRetryable: statusCode === 429 || statusCode >= 500,
  });
}

async function* parts(
  items: Array<{ type: string } & Record<string, unknown>>,
): AsyncGenerator<{ type: string }> {
  for (const item of items) {
    yield item;
  }
}

async function collect(iterable: AsyncIterable<ProviderChunk>): Promise<ProviderChunk[]> {
  const chunks: ProviderChunk[] = [];

  for await (const chunk of iterable) {
    chunks.push(chunk);
  }

  return chunks;
}

function input(overrides: Partial<ProviderStepInput> = {}): ProviderStepInput {
  return {
    model: DEEPSEEK_DEFAULT_MODEL,
    messages: [{ role: "user", content: "hello" }],
    tools: [],
    signal: new AbortController().signal,
    apiKey: "test-key",
    ...overrides,
  };
}

describe("DeepSeek stream mapping", () => {
  it("maps text deltas, tool calls and usage into provider chunks", async () => {
    const chunks = await collect(
      mapAiSdkStream(
        parts([
          { type: "start" },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", text: "Hel" },
          { type: "text-delta", id: "t1", text: "lo" },
          { type: "text-end", id: "t1" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_file",
            input: { path: "README.md" },
          },
          {
            type: "finish",
            finishReason: "tool-calls",
            totalUsage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
          },
        ]),
      ),
    );

    expect(chunks).toEqual([
      { type: "text-delta", text: "Hel" },
      { type: "text-delta", text: "lo" },
      {
        type: "tool-call",
        toolCall: { id: "call_1", name: "read_file", args: { path: "README.md" } },
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 12, outputTokens: 6, totalTokens: 18 },
      },
    ]);
  });

  it("passes reasoning through and synthesizes a finish when the stream ends early", async () => {
    const chunks = await collect(
      mapAiSdkStream(
        parts([
          { type: "reasoning-delta", text: "thinking" },
          { type: "text-delta", text: "answer" },
        ]),
      ),
    );

    expect(chunks).toEqual([
      { type: "reasoning-delta", text: "thinking" },
      { type: "text-delta", text: "answer" },
      { type: "finish", finishReason: "other" },
    ]);
  });

  it("maps provider errors and content filtering to stable codes", async () => {
    const unauthorized = await collect(
      mapAiSdkStream(parts([{ type: "error", error: apiError(401, "Unauthorized") }])),
    );
    expect(unauthorized[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_AUTH_FAILED", retryable: false },
    });

    const filtered = await collect(
      mapAiSdkStream(parts([{ type: "finish", finishReason: "content-filter", totalUsage: {} }])),
    );
    expect(filtered[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_CONTENT_FILTERED" },
    });

    const aborted = await collect(mapAiSdkStream(parts([{ type: "abort" }])));
    expect(aborted[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_ABORTED" },
    });
  });

  it("keeps FakeProvider and AI SDK mapping equivalent for the same script", async () => {
    const toolCall = {
      type: "tool-call",
      toolCallId: "call_9",
      toolName: "list_files",
      input: { path: "." },
    };
    const finish = {
      type: "finish",
      finishReason: "tool-calls",
      totalUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    };
    const expected: ProviderChunk[] = [
      { type: "text-delta", text: "checking" },
      {
        type: "tool-call",
        toolCall: { id: "call_9", name: "list_files", args: { path: "." } },
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
    ];

    const mapped = await collect(
      mapAiSdkStream(parts([{ type: "text-delta", text: "checking" }, toolCall, finish])),
    );
    const fake = createFakeProvider([{ chunks: expected }]);
    const scripted = await collect(fake.streamStep(input()));

    expect(mapped).toEqual(expected);
    expect(scripted).toEqual(expected);
  });
});

describe("DeepSeek error classification", () => {
  it("classifies auth, rate limit, context, server and unknown errors", () => {
    expect(classifyProviderError(apiError(401, "Unauthorized"))).toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
      retryable: false,
      statusCode: 401,
    });
    expect(classifyProviderError(apiError(403, "Forbidden"))).toMatchObject({
      code: "PROVIDER_AUTH_FAILED",
    });
    expect(classifyProviderError(apiError(429, "Too many requests"))).toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
    });
    expect(
      classifyProviderError(
        apiError(400, "Bad request", '{"error":{"message":"maximum context length exceeded"}}'),
      ),
    ).toMatchObject({ code: "PROVIDER_CONTEXT_LIMIT" });
    expect(classifyProviderError(apiError(500, "upstream failed"))).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(classifyProviderError(apiError(400, "bad request"))).toMatchObject({
      code: "PROVIDER_UNKNOWN",
    });
  });

  it("classifies aborts and timeouts without leaking raw messages", () => {
    const abort = Object.assign(new Error("aborted by user"), { name: "AbortError" });
    const timeout = Object.assign(new Error("request timed out"), { name: "TimeoutError" });

    expect(classifyProviderError(abort)).toMatchObject({ code: "PROVIDER_ABORTED" });
    const classifiedTimeout = classifyProviderError(timeout);
    expect(classifiedTimeout).toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
    expect(classifiedTimeout.message).toBe("provider request timed out");
  });

  it("unwraps retry errors to the underlying provider failure", () => {
    const retried = new RetryError({
      message: "failed after retries",
      reason: "maxRetriesExceeded",
      errors: [apiError(429, "Too many requests")],
    });
    expect(classifyProviderError(retried)).toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
      retryable: true,
    });

    const aborted = new RetryError({
      message: "aborted",
      reason: "abort",
      errors: [],
    });
    expect(classifyProviderError(aborted)).toMatchObject({ code: "PROVIDER_ABORTED" });
  });

  it("rejects a missing API key before calling the network", async () => {
    const provider = createDeepSeekProvider();
    const chunks = await collect(provider.streamStep(input({ apiKey: undefined })));

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      type: "error",
      error: { code: "PROVIDER_AUTH_FAILED" },
    });
  });
});

describe("DeepSeek request mapping", () => {
  it("maps normalized messages including tool calls and tool results", () => {
    const messages = toAiSdkMessages([
      { role: "system", content: "system" },
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "calling",
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "a.txt" } }],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        toolName: "read_file",
        content: "contents",
      },
      {
        role: "tool",
        toolCallId: "call_2",
        toolName: "read_file",
        content: "missing",
        isError: true,
      },
    ]);

    expect(messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_1",
            toolName: "read_file",
            output: { type: "text", value: "contents" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_2",
            toolName: "read_file",
            output: { type: "error-text", value: "missing" },
          },
        ],
      },
    ]);
  });

  it("converts tool schemas for the AI SDK", () => {
    const tools = toAiSdkTools([
      {
        name: "read_file",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);

    expect(tools).toBeDefined();
    expect(tools?.read_file).toMatchObject({ description: "Read a file" });
    expect(toAiSdkTools([])).toBeUndefined();
  });

  it("round-trips assistant reasoning ahead of tool calls", () => {
    const messages = toAiSdkMessages([
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", args: { path: "a.txt" } }],
        reasoning: "private-thought",
      },
    ]);

    expect(messages).toEqual([
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "private-thought" },
          {
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "read_file",
            input: { path: "a.txt" },
          },
        ],
      },
    ]);
  });

  it("maps thinking settings to DeepSeek provider options", () => {
    expect(toDeepSeekProviderOptions(undefined)).toBeUndefined();
    expect(toDeepSeekProviderOptions({ enabled: false })).toEqual({
      deepseek: { thinking: { type: "disabled" } },
    });
    expect(toDeepSeekProviderOptions({ enabled: true })).toEqual({
      deepseek: { thinking: { type: "enabled" } },
    });
    expect(toDeepSeekProviderOptions({ enabled: true, effort: "high" })).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "high" },
    });
    expect(toDeepSeekProviderOptions({ enabled: true, effort: "max" })).toEqual({
      deepseek: { thinking: { type: "enabled" }, reasoningEffort: "max" },
    });
  });
});
