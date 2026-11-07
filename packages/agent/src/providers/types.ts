import type { ProviderError } from "./errors.js";

export type ProviderId = "deepseek" | "glm" | "openai-compatible" | "fake";

export type ProviderFinishReason =
  | "stop"
  | "tool-calls"
  | "length"
  | "content-filter"
  | "error"
  | "other";

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  vision: boolean;
  reasoning: boolean;
  maxContextTokens: number;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  args: unknown;
}

export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCallRequest[]; reasoning?: string }
  | {
      role: "tool";
      toolCallId: string;
      toolName: string;
      content: string;
      isError?: boolean;
    };

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ProviderThinkingEffort = "low" | "high" | "max";

export interface ProviderThinking {
  enabled: boolean;
  effort?: ProviderThinkingEffort;
}

export type ProviderChunk =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-call"; toolCall: ToolCallRequest }
  | { type: "finish"; finishReason: ProviderFinishReason; usage?: ProviderUsage }
  | { type: "error"; error: ProviderError };

export interface ProviderStepInput {
  model: string;
  messages: ModelMessage[];
  tools: ToolSchema[];
  signal: AbortSignal;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  thinking?: ProviderThinking;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  streamStep(input: ProviderStepInput): AsyncIterable<ProviderChunk>;
}

export interface ModelProfile {
  id: string;
  label: string;
  provider: ProviderId;
  model: string;
  endpoint?: string | null;
  credentialProfileId?: string | null;
}
