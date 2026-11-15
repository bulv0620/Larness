import type { ModelCapabilities } from "./capabilities.js";
import { type CatalogThinking, effortThinking } from "./reasoningCatalog.js";

interface OfficialModel {
  id: string;
  label?: string;
  contextWindow?: number;
  thinking?: CatalogThinking;
  capabilities?: ModelCapabilities;
  expiresAt?: number;
}

const agentText: ModelCapabilities = {
  tools: true,
  streaming: true,
  inputModalities: ["text"],
  outputModalities: ["text"],
};
const agentVision: ModelCapabilities = { ...agentText, inputModalities: ["text", "image"] };
const agentVideo: ModelCapabilities = { ...agentText, inputModalities: ["text", "image", "video"] };
const standardEfforts = ["low", "high", "max"];

// https://platform.kimi.com/docs/models and /docs/guide/use-thinking-models
const kimiApiModels: readonly OfficialModel[] = [
  {
    id: "kimi-k3.1-pro",
    label: "Kimi K3.1 Pro",
    contextWindow: 1_000_000,
    capabilities: agentVision,
    thinking: effortThinking(standardEfforts, "max"),
  },
  {
    id: "kimi-k3.1-pro-highspeed",
    label: "Kimi K3.1 Pro Highspeed",
    contextWindow: 1_000_000,
    capabilities: agentVision,
    thinking: effortThinking(standardEfforts, "max"),
  },
  {
    id: "kimi-k3",
    label: "Kimi K3",
    contextWindow: 1_000_000,
    capabilities: agentVision,
    thinking: effortThinking(standardEfforts, "max"),
  },
];

// https://www.kimi.com/code/docs/en/kimi-code/models.html
// Use the lower published tier window when the same ID has a tier-dependent limit.
const kimiCodeModels: readonly OfficialModel[] = [
  {
    id: "k3.1-pro",
    label: "Kimi K3.1 Pro",
    contextWindow: 262_144,
    capabilities: agentVideo,
    thinking: effortThinking(standardEfforts, "high"),
  },
  {
    id: "k3.1-pro-highspeed",
    label: "Kimi K3.1 Pro Highspeed",
    contextWindow: 1_048_576,
    capabilities: agentVideo,
    thinking: effortThinking(standardEfforts, "high"),
  },
  {
    id: "k3",
    label: "Kimi K3",
    contextWindow: 262_144,
    capabilities: agentVideo,
    thinking: effortThinking(standardEfforts, "high"),
  },
  {
    id: "k3-256k",
    label: "Kimi K3 256K",
    contextWindow: 262_144,
    capabilities: agentVision,
    thinking: effortThinking(standardEfforts, "high"),
  },
  {
    id: "kimi-for-coding",
    label: "Kimi K2.8 Preview",
    contextWindow: 1_048_576,
    capabilities: agentVideo,
    thinking: effortThinking(standardEfforts, "max"),
  },
  {
    id: "kimi-for-coding-highspeed",
    label: "Kimi K2.7 Code Highspeed",
    contextWindow: 262_144,
    capabilities: agentVideo,
    thinking: effortThinking([]),
  },
];

// https://platform.minimax.io/docs/api-reference/text-openai-api and /docs/m-plan/intro
const miniMaxFlash: OfficialModel = {
  id: "MiniMax-M3.1-Flash",
  label: "MiniMax M3.1 Flash",
  contextWindow: 1_000_000,
  capabilities: agentVideo,
  thinking: effortThinking(["low", "medium", "high", "xhigh", "max"], "max"),
};
const miniMaxApiModels: readonly OfficialModel[] = [
  miniMaxFlash,
  {
    id: "MiniMax-M3",
    label: "MiniMax M3",
    contextWindow: 1_000_000,
    capabilities: agentVideo,
    thinking: { supported: true, reasoning: true, mode: "toggle", levels: [] },
  },
];

// https://help.aliyun.com/zh/model-studio/coding-plan and /en/model-studio/coding-plan-faq
const bailianCodingModels: readonly OfficialModel[] = [
  { id: "qwen3.7-plus", contextWindow: 1_000_000, capabilities: agentVision },
  { id: "qwen3.6-plus", contextWindow: 1_000_000, capabilities: agentVision },
  { id: "qwen3.5-plus", contextWindow: 1_000_000, capabilities: agentVision },
  { id: "kimi-k2.5", contextWindow: 262_144, capabilities: agentVision },
  { id: "glm-5", contextWindow: 202_752, capabilities: agentText },
  { id: "MiniMax-M2.5", contextWindow: 196_608, capabilities: agentText },
];

// https://help.aliyun.com/en/model-studio/token-plan-personal-overview
// and /en/model-studio/token-plan-team-overview. Account tiers differ.
// Creative and decision models use different endpoints.
const bailianTokenModels: readonly OfficialModel[] = [
  { id: "auto" },
  {
    id: "qwen4-max-preview",
    capabilities: agentVision,
    expiresAt: Date.parse("2026-11-26T00:00:00+08:00"),
  },
  { id: "qwen3.8-max", capabilities: agentVideo, contextWindow: 1_000_000 },
  { id: "qwen3.8-flash", capabilities: agentVision },
  { id: "qwen3.7-max", capabilities: agentText },
  { id: "qwen3.7-plus", capabilities: agentVision },
  { id: "qwen3.6-flash", capabilities: agentVision },
  { id: "deepseek-v4.1-flash", capabilities: agentVision },
  { id: "deepseek-v4.1-flash-1017", capabilities: agentVision },
  { id: "deepseek-v4-pro", capabilities: agentText },
  { id: "deepseek-v4-pro-0813", capabilities: agentText },
  { id: "deepseek-v4-flash-0731", capabilities: agentText },
  { id: "glm-5.3", capabilities: agentText },
  { id: "glm-5.2", capabilities: agentText },
  { id: "qwen3.6-plus", capabilities: agentVision },
  { id: "deepseek-v4-flash", capabilities: agentText },
  { id: "deepseek-v3.2", capabilities: agentText },
  { id: "kimi-k2.7-code", capabilities: agentVision },
  { id: "kimi-k2.6", capabilities: agentVision },
  { id: "kimi-k2.5", capabilities: agentVision },
  { id: "glm-5.1", capabilities: agentText },
  { id: "glm-5", capabilities: agentText },
  { id: "MiniMax-M2.5", capabilities: agentText },
];

// https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions
const hybridBailianModels = new Set([
  "qwen3.8-max",
  "qwen3.8-max-0902",
  "qwen3.8-flash",
  "qwen3.7-max",
  "qwen3.7-max-2026-05-20",
  "qwen3.7-plus",
  "qwen3.7-plus-2026-05-26",
  "qwen3.7-flash",
  "qwen3.7-flash-2026-07-15",
  "qwen3.6-plus",
  "qwen3.6-plus-2026-04-02",
  "qwen3.6-flash",
  "qwen3.6-flash-2026-04-16",
  "qwen3.5-plus",
  "qwen3-vl-plus",
]);

const publishedCandidates = new Map<string, { url: string; models: readonly OfficialModel[] }>([
  [
    "bailian-coding",
    { url: "https://help.aliyun.com/zh/model-studio/coding-plan", models: bailianCodingModels },
  ],
  [
    "bailian-token",
    {
      url: "https://help.aliyun.com/en/model-studio/token-plan-personal-overview",
      models: bailianTokenModels,
    },
  ],
  [
    "kimi-code-cn",
    { url: "https://www.kimi.com/code/docs/en/kimi-code/models.html", models: kimiCodeModels },
  ],
  [
    "kimi-code-intl",
    { url: "https://www.kimi.com/code/docs/en/kimi-code/models.html", models: kimiCodeModels },
  ],
  [
    "minimax-api-cn",
    {
      url: "https://platform.minimax.cn/docs/api-reference/text-openai-api",
      models: miniMaxApiModels,
    },
  ],
  [
    "minimax-api-intl",
    {
      url: "https://platform.minimax.io/docs/api-reference/text-openai-api",
      models: miniMaxApiModels,
    },
  ],
  [
    "minimax-plan-cn",
    { url: "https://platform.minimax.cn/docs/m-plan/intro", models: [miniMaxFlash] },
  ],
  [
    "minimax-plan-intl",
    { url: "https://platform.minimax.io/docs/m-plan/intro", models: [miniMaxFlash] },
  ],
]);

export function publishedCatalog(presetId: string | undefined) {
  return presetId === undefined ? undefined : publishedCandidates.get(presetId);
}

export function officialModel(presetId: string | undefined, id: string): OfficialModel | undefined {
  const model = presetId?.startsWith("kimi-api-")
    ? kimiApiModels.find((item) => item.id === id)
    : publishedCatalog(presetId)?.models.find((item) => item.id === id);
  if (presetId?.startsWith("bailian-") && hybridBailianModels.has(id)) {
    const limits =
      id === "qwen3.7-plus" || id === "qwen3.8-max" || id === "qwen3.8-flash"
        ? {
            contextWindow: 1_000_000,
            capabilities: {
              ...agentVision,
              ...model?.capabilities,
              maxInputTokens: 983_616,
              maxOutputTokens: 131_072,
            },
          }
        : {};
    return { ...model, ...limits, id, thinking: effortThinking([], undefined, true) };
  }
  return model;
}
