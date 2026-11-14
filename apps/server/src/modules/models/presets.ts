import { GLM_ENDPOINTS } from "@larness/agent";
import type { ModelProviderId } from "../../db/schema.js";

export interface ConnectionPreset {
  id: string;
  provider: ModelProviderId;
  label: string;
  endpoint: string | null;
  billing: "usage" | "subscription" | "unknown";
  catalogUrl?: string;
  directoryId?: string;
  fields?: ("endpoint" | "workspaceId")[];
  interactiveOnly?: boolean;
  candidateDirectory?: boolean;
  workspaceRegion?: string;
}

export const MODEL_CONNECTION_PRESETS: readonly ConnectionPreset[] = [
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
  {
    id: "opencode-go",
    provider: "opencode-go",
    label: "OpenCode Go",
    billing: "subscription",
    endpoint: "https://opencode.ai/inference/go/openai/v1",
    catalogUrl: "https://opencode.ai/inference/go/v1/models",
    directoryId: "opencode-go",
  },
  {
    id: "bailian-standard-cn",
    provider: "bailian",
    label: "百炼北京 · 标准 API",
    billing: "usage",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    directoryId: "alibaba-cn",
    candidateDirectory: true,
  },
  {
    id: "bailian-standard-sg",
    provider: "bailian",
    label: "百炼新加坡 · 标准 API",
    billing: "usage",
    endpoint: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    directoryId: "alibaba",
    candidateDirectory: true,
  },
  {
    id: "bailian-standard-us",
    provider: "bailian",
    label: "百炼美国 · 标准 API",
    billing: "usage",
    endpoint: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
    candidateDirectory: true,
  },
  {
    id: "bailian-standard-hk",
    provider: "bailian",
    label: "百炼香港 · 标准 API",
    billing: "usage",
    endpoint: "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
    candidateDirectory: true,
  },
  {
    id: "bailian-workspace-cn",
    provider: "bailian",
    label: "百炼北京 · 业务空间",
    billing: "usage",
    endpoint: null,
    fields: ["workspaceId"],
    workspaceRegion: "cn-beijing",
    directoryId: "alibaba-cn",
  },
  {
    id: "bailian-workspace-sg",
    provider: "bailian",
    label: "百炼新加坡 · 业务空间",
    billing: "usage",
    endpoint: null,
    fields: ["workspaceId"],
    workspaceRegion: "ap-southeast-1",
    directoryId: "alibaba",
  },
  {
    id: "bailian-coding",
    provider: "bailian",
    label: "百炼 · Coding Plan",
    billing: "subscription",
    endpoint: "https://coding.dashscope.aliyuncs.com/v1",
    directoryId: "alibaba-coding-plan-cn",
    candidateDirectory: true,
    interactiveOnly: true,
  },
  {
    id: "bailian-token",
    provider: "bailian",
    label: "百炼 · Token Plan",
    billing: "subscription",
    endpoint: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    directoryId: "alibaba-token-plan-cn",
    candidateDirectory: true,
    interactiveOnly: true,
  },
  {
    id: "kimi-api-cn",
    provider: "kimi",
    label: "Kimi 开放平台 · 国内",
    billing: "usage",
    endpoint: "https://api.moonshot.cn/v1",
    directoryId: "moonshotai-cn",
  },
  {
    id: "kimi-api-intl",
    provider: "kimi",
    label: "Kimi 开放平台 · 国际",
    billing: "usage",
    endpoint: "https://api.moonshot.ai/v1",
    directoryId: "moonshotai",
  },
  {
    id: "kimi-code-cn",
    provider: "kimi",
    label: "Kimi Code · 国内",
    billing: "subscription",
    endpoint: "https://api.kimi.com/coding/v1",
    directoryId: "kimi-code-plan-cn",
    candidateDirectory: true,
    interactiveOnly: true,
  },
  {
    id: "kimi-code-intl",
    provider: "kimi",
    label: "Kimi Code · 国际",
    billing: "subscription",
    endpoint: "https://api.kimi.ai/coding/v1",
    directoryId: "kimi-code-plan-global",
    candidateDirectory: true,
    interactiveOnly: true,
  },
  {
    id: "minimax-api-cn",
    provider: "minimax",
    label: "MiniMax 国内 · 标准 API",
    billing: "usage",
    endpoint: "https://api.minimax.cn/v1",
    directoryId: "minimax-cn",
    candidateDirectory: true,
  },
  {
    id: "minimax-api-intl",
    provider: "minimax",
    label: "MiniMax 国际 · 标准 API",
    billing: "usage",
    endpoint: "https://api.minimax.io/v1",
    directoryId: "minimax",
    candidateDirectory: true,
  },
  {
    id: "minimax-plan-cn",
    provider: "minimax",
    label: "MiniMax 国内 · M Plan",
    billing: "subscription",
    endpoint: "https://api.minimax.cn/v1",
    directoryId: "minimax-cn-coding-plan",
    candidateDirectory: true,
    interactiveOnly: true,
  },
  {
    id: "minimax-plan-intl",
    provider: "minimax",
    label: "MiniMax 国际 · M Plan",
    billing: "subscription",
    endpoint: "https://api.minimax.io/v1",
    directoryId: "minimax-coding-plan",
    candidateDirectory: true,
    interactiveOnly: true,
  },
];

export function findConnectionPreset(id: string): ConnectionPreset | undefined {
  return MODEL_CONNECTION_PRESETS.find((preset) => preset.id === id);
}

export function presetForCredential(
  provider: ModelProviderId,
  endpoint: string | null,
  presetId?: string | null,
): ConnectionPreset | undefined {
  return MODEL_CONNECTION_PRESETS.find((preset) => {
    if (preset.provider !== provider || (presetId != null && preset.id !== presetId)) return false;
    if (provider === "openai-compatible") return true;
    if (preset.workspaceRegion !== undefined && endpoint !== null) {
      const match =
        /^https:\/\/([a-z0-9][a-z0-9-]{0,62})\.([a-z0-9-]+)\.maas\.aliyuncs\.com\/compatible-mode\/v1$/.exec(
          endpoint,
        );
      return match?.[2] === preset.workspaceRegion;
    }
    return (
      preset.endpoint === (provider === "glm" ? (endpoint ?? GLM_ENDPOINTS.standardCn) : endpoint)
    );
  });
}
