import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamText } from "ai";
import {
  classifyProviderError,
  mapAiSdkStream,
  toAiSdkMessages,
  toAiSdkTools,
} from "./deepseek.js";
import { ProviderError } from "./errors.js";
import type {
  ProviderAdapter,
  ProviderCapabilities,
  ProviderChunk,
  ProviderStepInput,
  ProviderThinking,
} from "./types.js";

export const GLM_ENDPOINTS = {
  standardCn: "https://open.bigmodel.cn/api/paas/v4",
  codingCn: "https://open.bigmodel.cn/api/coding/paas/v4",
  standardIntl: "https://api.z.ai/api/paas/v4",
  codingIntl: "https://api.z.ai/api/coding/paas/v4",
} as const;

export type GlmEndpoint = (typeof GLM_ENDPOINTS)[keyof typeof GLM_ENDPOINTS];

export const GLM_BASE_URL: GlmEndpoint = GLM_ENDPOINTS.standardCn;
export const DEFAULT_COMPATIBLE_TIMEOUT_MS = 120_000;

const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });

const COMPATIBLE_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalls: true,
  vision: false,
  reasoning: false,
  maxContextTokens: 128_000,
};

export interface CompatibleProviderOptions {
  id: "glm" | "openai-compatible";
  name: string;
  baseURL: string;
  capabilities?: Partial<ProviderCapabilities>;
  timeoutMs?: number;
}

export function toCompatibleProviderOptions(
  name: string,
  thinking: ProviderThinking | undefined,
): Record<string, Record<string, string | { type: string }>> | undefined {
  if (thinking === undefined) return undefined;

  return {
    [name]: {
      thinking: { type: thinking.enabled ? "enabled" : "disabled" },
      ...(thinking.enabled && thinking.effort !== undefined
        ? { reasoning_effort: thinking.effort }
        : {}),
    },
  };
}

/**
 * Provider for GLM and generic OpenAI-compatible endpoints. The endpoint must
 * be validated by the server before it reaches this factory.
 */
export function createCompatibleProvider(options: CompatibleProviderOptions): ProviderAdapter {
  const capabilities = { ...COMPATIBLE_CAPABILITIES, ...options.capabilities };

  return {
    id: options.id,
    capabilities,
    async *streamStep(input: ProviderStepInput): AsyncGenerator<ProviderChunk> {
      if (input.apiKey === undefined || input.apiKey.trim().length === 0) {
        yield {
          type: "error",
          error: new ProviderError("PROVIDER_AUTH_FAILED", `${options.name} API key is missing`),
        };
        return;
      }

      try {
        const provider = createOpenAICompatible({
          name: options.name,
          baseURL: input.endpoint ?? options.baseURL,
          apiKey: input.apiKey,
          fetch: noRedirectFetch,
        });
        const tools = toAiSdkTools(input.tools);
        const providerOptions = toCompatibleProviderOptions(options.name, input.thinking);
        const result = streamText({
          model: provider(input.model),
          messages: toAiSdkMessages(input.messages),
          abortSignal: input.signal,
          timeout: options.timeoutMs ?? input.timeoutMs ?? DEFAULT_COMPATIBLE_TIMEOUT_MS,
          ...(tools === undefined ? {} : { tools }),
          ...(providerOptions === undefined ? {} : { providerOptions }),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: input.maxOutputTokens }),
        });

        for await (const chunk of mapAiSdkStream(result.fullStream)) {
          if (
            options.id === "glm" &&
            chunk.type === "error" &&
            chunk.error.code === "PROVIDER_QUOTA_EXHAUSTED"
          ) {
            yield {
              type: "error",
              error: new ProviderError(
                "PROVIDER_QUOTA_EXHAUSTED",
                "模型账户余额不足或资源包不可用；若使用 Coding Plan Key，请在设置 → GLM Key → 端点切换为 Coding Plan",
              ),
            };
            continue;
          }

          yield chunk;
        }
      } catch (error) {
        yield { type: "error", error: classifyProviderError(error) };
      }
    },
  };
}

export function createGlmProvider(
  options: Omit<CompatibleProviderOptions, "id" | "name" | "baseURL"> = {},
): ProviderAdapter {
  return createCompatibleProvider({
    ...options,
    id: "glm",
    name: "glm",
    baseURL: GLM_BASE_URL,
    capabilities: { ...options.capabilities, reasoning: true },
  });
}
