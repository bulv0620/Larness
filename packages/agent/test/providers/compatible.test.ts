import { describe, expect, it } from "vitest";
import {
  createCompatibleProvider,
  createGlmProvider,
  GLM_BASE_URL,
} from "../../src/providers/index.js";

describe("compatible providers", () => {
  it("exposes GLM identity and capabilities", () => {
    const provider = createGlmProvider();
    expect(provider.id).toBe("glm");
    expect(provider.capabilities).toMatchObject({
      streaming: true,
      toolCalls: true,
      vision: false,
      reasoning: false,
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
});
