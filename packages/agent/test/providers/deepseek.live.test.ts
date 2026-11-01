import { describe, expect, it } from "vitest";
import {
  createDeepSeekProvider,
  DEEPSEEK_DEFAULT_MODEL,
  type ProviderChunk,
} from "../../src/providers/index.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
const enabled =
  process.env.LARNESS_DEEPSEEK_SMOKE === "1" && apiKey !== undefined && apiKey.length > 0;

describe.skipIf(!enabled)("DeepSeek live smoke", () => {
  it("streams a tool call for deepseek-chat", async () => {
    const provider = createDeepSeekProvider({ timeoutMs: 60_000 });
    const chunks: ProviderChunk[] = [];
    const controller = new AbortController();

    for await (const chunk of provider.streamStep({
      model: DEEPSEEK_DEFAULT_MODEL,
      signal: controller.signal,
      apiKey: apiKey as string,
      messages: [
        {
          role: "system",
          content:
            "You are a file assistant. When asked to inspect a project you must call a tool instead of answering from memory.",
        },
        { role: "user", content: "List the files in the project root using the list_files tool." },
      ],
      tools: [
        {
          name: "list_files",
          description: "List files under a project-relative directory.",
          parameters: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative directory, use . for root" },
            },
            required: ["path"],
          },
        },
      ],
    })) {
      chunks.push(chunk);

      if (chunk.type === "error" || chunk.type === "finish") {
        break;
      }
    }

    expect(chunks.some((chunk) => chunk.type === "error")).toBe(false);
    expect(chunks.some((chunk) => chunk.type === "tool-call")).toBe(true);
  }, 90_000);
});
