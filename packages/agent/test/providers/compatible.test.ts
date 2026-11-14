import { describe, expect, it } from "vitest";
import {
  createCompatibleProvider,
  createGlmProvider,
  GLM_BASE_URL,
  toCompatibleProviderOptions,
} from "../../src/providers/index.js";

describe("compatible providers", () => {
  it("exposes GLM identity and capabilities", () => {
    const provider = createGlmProvider();
    expect(provider.id).toBe("glm");
    expect(provider.capabilities).toMatchObject({
      streaming: true,
      toolCalls: true,
      vision: false,
      reasoning: true,
    });
    expect(GLM_BASE_URL).toBe("https://open.bigmodel.cn/api/paas/v4");
  });

  it("fails closed when the credential is missing", async () => {
    const provider = createGlmProvider();
    const chunks = [];

    for await (const chunk of provider.streamStep({
      model: "glm-4.6",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      signal: new AbortController().signal,
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      {
        type: "error",
        error: expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
      },
    ]);
  });

  it("keeps the provider id for custom compatible endpoints", () => {
    const provider = createCompatibleProvider({
      id: "openai-compatible",
      name: "compatible",
      baseURL: "https://api.example.com/v1",
    });
    expect(provider.id).toBe("openai-compatible");
    expect(provider.capabilities.toolCalls).toBe(true);
  });
  it("maps thinking settings to provider options", () => {
    expect(toCompatibleProviderOptions("glm", undefined)).toBeUndefined();
    expect(toCompatibleProviderOptions("glm", { enabled: false })).toEqual({
      glm: { thinking: { type: "disabled" } },
    });
    expect(toCompatibleProviderOptions("glm", { enabled: true })).toEqual({
      glm: { thinking: { type: "enabled" } },
    });
    expect(toCompatibleProviderOptions("glm", { enabled: true, effort: "max" })).toEqual({
      glm: { thinking: { type: "enabled" }, reasoning_effort: "max" },
    });
  });
});

it("maps MiniMax output limits and preserves reasoning on tool continuations", async () => {
  const provider = createCompatibleProvider({
    id: "minimax",
    name: "minimax",
    baseURL: "https://api.minimax.cn/v1",
  });
  const original = globalThis.fetch;
  const bodies: unknown[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response('data: {"base_resp":{"status_code":1008}}\n\ndata: [DONE]\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const chunks = [];
    for await (const chunk of provider.streamStep({
      model: "MiniMax-M3.1-Flash",
      apiKey: "placeholder",
      maxOutputTokens: 200,
      signal: new AbortController().signal,
      tools: [],
      messages: [
        { role: "user", content: "go" },
        {
          role: "assistant",
          content: "",
          reasoning: "prior reasoning",
          toolCalls: [{ id: "one", name: "inspect", args: {} }],
        },
        { role: "tool", toolCallId: "one", toolName: "inspect", content: "done" },
      ],
    }))
      chunks.push(chunk);
    expect(bodies).toMatchObject([
      {
        max_completion_tokens: 200,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "assistant", reasoning_content: "prior reasoning" }),
        ]),
      },
    ]);
    expect(chunks).toMatchObject([{ type: "error", error: { code: "PROVIDER_QUOTA_EXHAUSTED" } }]);
  } finally {
    globalThis.fetch = original;
  }
});
