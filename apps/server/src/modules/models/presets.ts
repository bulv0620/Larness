import { GLM_ENDPOINTS } from "@larness/agent";
import type { ModelProviderId } from "../../db/schema.js";

export const MODEL_CONNECTION_PRESETS = [
  { id: "deepseek-api", provider: "deepseek", label: "DeepSeek", endpoint: null, billing: "usage" },
  {
    id: "glm-standard-cn",
    provider: "glm",
    label: "智谱国内 · 标准 API",
    endpoint: GLM_ENDPOINTS.standardCn,
    billing: "usage",
  },
  {
    id: "glm-coding-cn",
    provider: "glm",
    label: "智谱国内 · Coding Plan",
    endpoint: GLM_ENDPOINTS.codingCn,
    billing: "subscription",
  },
  {
    id: "glm-standard-intl",
    provider: "glm",
    label: "Z.AI · 标准 API",
    endpoint: GLM_ENDPOINTS.standardIntl,
    billing: "usage",
  },
  {
    id: "glm-coding-intl",
    provider: "glm",
    label: "Z.AI · Coding Plan",
    endpoint: GLM_ENDPOINTS.codingIntl,
    billing: "subscription",
  },
  {
    id: "openai-compatible",
    provider: "openai-compatible",
    label: "OpenAI 兼容",
    endpoint: null,
    billing: "unknown",
  },
] as const;

export type ConnectionPreset = (typeof MODEL_CONNECTION_PRESETS)[number];

export function findConnectionPreset(id: string): ConnectionPreset | undefined {
  return MODEL_CONNECTION_PRESETS.find((preset) => preset.id === id);
}

export function presetForCredential(
  provider: ModelProviderId,
  endpoint: string | null,
): ConnectionPreset | undefined {
  return MODEL_CONNECTION_PRESETS.find(
    (preset) =>
      preset.provider === provider &&
      (provider !== "glm" || preset.endpoint === (endpoint ?? GLM_ENDPOINTS.standardCn)),
  );
}
