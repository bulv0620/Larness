import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  type ModelMessage as AiModelMessage,
  APICallError,
  type AssistantContent,
  type JSONSchema7,
  jsonSchema,
  RetryError,
  streamText,
  type ToolSet,
  tool,
} from "ai";
import { isAbortError, isTimeoutError, ProviderError, type ProviderErrorCode } from "./errors.js";
import type {
  ModelMessage,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderChunk,
  ProviderFinishReason,
  ProviderStepInput,
  ProviderUsage,
  ToolSchema,
} from "./types.js";

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";
export const DEEPSEEK_DEFAULT_TIMEOUT_MS = 120_000;

export const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalls: true,
  vision: false,
  reasoning: false,
  maxContextTokens: 128_000,
};

interface RawStreamPart {
  type: string;
  text?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
  finishReason?: unknown;
  totalUsage?: unknown;
  error?: unknown;
}

const CONTEXT_LIMIT_PATTERN =
  /context (?:length|window)|maximum context|too many tokens|token limit|input is too long|context_length_exceeded/;
const CONTENT_FILTER_PATTERN = /content filter|content_filter|safety|moderation|flagged/;

function mapFinishReason(value: unknown): ProviderFinishReason {
  switch (value) {
    case "stop":
    case "tool-calls":
    case "length":
    case "content-filter":
    case "error":
      return value;
    default:
      return "other";
  }
}

function mapUsage(value: unknown): ProviderUsage | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const numberOrUndefined = (candidate: unknown): number | undefined =>
    typeof candidate === "number" ? candidate : undefined;
  const mapped: ProviderUsage = {
    inputTokens: numberOrUndefined(usage.inputTokens),
    outputTokens: numberOrUndefined(usage.outputTokens),
    totalTokens: numberOrUndefined(usage.totalTokens),
  };

  return mapped.inputTokens === undefined &&
    mapped.outputTokens === undefined &&
    mapped.totalTokens === undefined
    ? undefined
    : mapped;
}

function providerFailure(
  code: ProviderErrorCode,
  message: string,
  statusCode?: number,
): ProviderError {
  return new ProviderError(code, message, {
    ...(statusCode === undefined ? {} : { statusCode }),
  });
}

export function classifyProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  if (isAbortError(error)) {
    return providerFailure("PROVIDER_ABORTED", "provider request aborted");
  }

  if (isTimeoutError(error)) {
    return providerFailure("PROVIDER_UNAVAILABLE", "provider request timed out");
  }

  if (RetryError.isInstance(error)) {
    if (error.reason === "abort") {
      return providerFailure("PROVIDER_ABORTED", "provider request aborted");
    }

    if (error.lastError !== undefined) {
      return classifyProviderError(error.lastError);
    }

    return providerFailure("PROVIDER_UNAVAILABLE", "provider request failed after retries");
  }

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    const haystack = `${error.message} ${error.responseBody ?? ""}`.toLowerCase();

    if (status === 401 || status === 403) {
      return providerFailure("PROVIDER_AUTH_FAILED", "provider rejected the credential", status);
    }

    if (status === 429) {
      return providerFailure("PROVIDER_RATE_LIMITED", "provider rate limit reached", status);
    }

    if (CONTEXT_LIMIT_PATTERN.test(haystack)) {
      return providerFailure("PROVIDER_CONTEXT_LIMIT", "provider context limit exceeded", status);
    }

    if (CONTENT_FILTER_PATTERN.test(haystack)) {
      return providerFailure("PROVIDER_CONTENT_FILTERED", "provider blocked the response", status);
    }

    if (status !== undefined && status >= 500) {
      return providerFailure("PROVIDER_UNAVAILABLE", "provider is unavailable", status);
    }

    if (error.isRetryable) {
      return providerFailure("PROVIDER_UNAVAILABLE", "provider request failed", status);
    }

    return providerFailure("PROVIDER_UNKNOWN", "provider request failed", status);
  }

  const message = error instanceof Error ? error.message : String(error);

  if (CONTEXT_LIMIT_PATTERN.test(message)) {
    return providerFailure("PROVIDER_CONTEXT_LIMIT", "provider context limit exceeded");
  }

  if (CONTENT_FILTER_PATTERN.test(message)) {
    return providerFailure("PROVIDER_CONTENT_FILTERED", "provider blocked the response");
  }

  return providerFailure("PROVIDER_UNKNOWN", "provider request failed");
}

export function toAiSdkMessages(messages: ModelMessage[]): AiModelMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case "system":
        return { role: "system", content: message.content };
      case "user":
        return { role: "user", content: message.content };
      case "assistant": {
        if (message.toolCalls === undefined || message.toolCalls.length === 0) {
          return { role: "assistant", content: message.content };
        }

        const content: AssistantContent = [];

        if (message.content.length > 0) {
          content.push({ type: "text", text: message.content });
        }

        for (const call of message.toolCalls) {
          content.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          });
        }

        return { role: "assistant", content };
      }
      case "tool": {
        const output = message.isError
          ? { type: "error-text" as const, value: message.content }
          : { type: "text" as const, value: message.content };

        return {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: message.toolCallId,
              toolName: message.toolName,
              output,
            },
          ],
        };
      }
    }

    throw new Error(`unsupported message role: ${(message as { role: string }).role}`);
  });
}

export function toAiSdkTools(tools: ToolSchema[]): ToolSet | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  const entries = tools.map((schema) => [
    schema.name,
    tool({
      description: schema.description,
      inputSchema: jsonSchema(schema.parameters as JSONSchema7),
    }),
  ]);

  return Object.fromEntries(entries) as ToolSet;
}

export async function* mapAiSdkStream(
  parts: AsyncIterable<{ type: string }>,
): AsyncGenerator<ProviderChunk> {
  let finished = false;

  for await (const rawPart of parts) {
    const part = rawPart as RawStreamPart;

    switch (part.type) {
      case "text-delta": {
        if (typeof part.text === "string" && part.text.length > 0) {
          yield { type: "text-delta", text: part.text };
        }
        break;
      }
      case "tool-call": {
        if (typeof part.toolCallId !== "string" || typeof part.toolName !== "string") {
          break;
        }

        yield {
          type: "tool-call",
          toolCall: {
            id: part.toolCallId,
            name: part.toolName,
            args: part.input ?? null,
          },
        };
        break;
      }
      case "finish": {
        finished = true;
        const finishReason = mapFinishReason(part.finishReason);

        if (finishReason === "content-filter") {
          yield {
            type: "error",
            error: providerFailure("PROVIDER_CONTENT_FILTERED", "provider blocked the response"),
          };
          return;
        }

        const usage = mapUsage(part.totalUsage);
        yield {
          type: "finish",
          finishReason,
          ...(usage === undefined ? {} : { usage }),
        };
        return;
      }
      case "abort": {
        yield {
          type: "error",
          error: providerFailure("PROVIDER_ABORTED", "provider request aborted"),
        };
        return;
      }
      case "error": {
        yield { type: "error", error: classifyProviderError(part.error) };
        return;
      }
      default:
        break;
    }
  }

  if (!finished) {
    yield { type: "finish", finishReason: "other" };
  }
}

export interface DeepSeekProviderOptions {
  timeoutMs?: number;
}

export function createDeepSeekProvider(options: DeepSeekProviderOptions = {}): ProviderAdapter {
  return {
    id: "deepseek",
    capabilities: DEEPSEEK_CAPABILITIES,
    async *streamStep(input: ProviderStepInput): AsyncGenerator<ProviderChunk> {
      if (input.apiKey === undefined || input.apiKey.trim().length === 0) {
        yield {
          type: "error",
          error: providerFailure("PROVIDER_AUTH_FAILED", "DeepSeek API key is missing"),
        };
        return;
      }

      try {
        const provider = createDeepSeek({
          apiKey: input.apiKey,
          ...(input.endpoint === undefined ? {} : { baseURL: input.endpoint }),
        });
        const tools = toAiSdkTools(input.tools);
        const result = streamText({
          model: provider(input.model),
          messages: toAiSdkMessages(input.messages),
          abortSignal: input.signal,
          timeout: options.timeoutMs ?? input.timeoutMs ?? DEEPSEEK_DEFAULT_TIMEOUT_MS,
          ...(tools === undefined ? {} : { tools }),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { maxOutputTokens: input.maxOutputTokens }),
        });

        yield* mapAiSdkStream(result.fullStream);
      } catch (error) {
        yield { type: "error", error: classifyProviderError(error) };
      }
    },
  };
}
