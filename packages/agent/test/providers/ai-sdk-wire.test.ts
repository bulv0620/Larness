import { afterEach, describe, expect, it, vi } from "vitest";
import { createCompatibleProvider, createDeepSeekProvider } from "../../src/providers/index.js";

describe("AI SDK provider wire contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    createDeepSeekProvider(),
    createCompatibleProvider({
      id: "openai-compatible",
      name: "test",
      baseURL: "http://127.0.0.1",
    }),
  ])("sends instructions, tool schema and tool results for $id", async (provider) => {
    const base = { id: "response", object: "chat.completion.chunk", model: "test" };
    const response = [
      { ...base, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: null }] },
      {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
      },
    ];
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          response.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
            "data: [DONE]\n\n",
          { headers: { "content-type": "text/event-stream" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const parameters = { type: "object", properties: { path: { type: "string" } } };
    const chunks = [];
    for await (const chunk of provider.streamStep({
      apiKey: "test-key",
      endpoint: "http://127.0.0.1",
      model: "test",
      signal: new AbortController().signal,
      messages: [
        { role: "system", content: "Project instructions" },
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "read_file", args: { path: "hello.txt" } }],
        },
        { role: "tool", toolCallId: "call-1", toolName: "read_file", content: "file content" },
      ],
      tools: [{ name: "read_file", description: "Read a file", parameters }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "text-delta", text: "ok" },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12, outputTokens: 3, totalTokens: 15 },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(String(requestBody))).toMatchObject({
      messages: [
        { role: "system", content: "Project instructions" },
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          tool_calls: [{ id: "call-1", function: { name: "read_file" } }],
        },
        { role: "tool", tool_call_id: "call-1", content: "file content" },
      ],
      tools: [{ type: "function", function: { name: "read_file", parameters } }],
    });
  });
});
