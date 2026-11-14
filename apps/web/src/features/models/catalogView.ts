import type { ApiCatalogGroup, ApiCatalogModel } from "@/lib/workspaceApi";

export function catalogModelKey(group: ApiCatalogGroup, model: ApiCatalogModel): string {
  // Only directly identified first-party models may share a row across credentials.
  const scope =
    group.provider === "deepseek" || group.provider === "glm"
      ? group.provider
      : group.credentialProfileId;
  return JSON.stringify([scope, model.id]);
}

export function providerLabel(provider: string): string {
  const names: Record<string, string> = {
    deepseek: "DeepSeek",
    glm: "GLM",
    "openai-compatible": "兼容",
    "opencode-go": "OpenCode Go",
    bailian: "阿里云百炼",
    kimi: "Kimi",
    minimax: "MiniMax",
  };
  return names[provider] ?? provider;
}

export function billingLabel(billing: string | undefined): string {
  if (billing === "usage") return "按量";
  if (billing === "subscription") return "套餐额度";
  return "计费方式未知";
}

export function modelRows(groups: ApiCatalogGroup[]) {
  const rows = new Map<string, { group: ApiCatalogGroup; model: ApiCatalogModel }[]>();
  for (const group of groups) {
    for (const model of group.models) {
      const key = catalogModelKey(group, model);
      const connections = rows.get(key) ?? [];
      connections.push({ group, model });
      rows.set(key, connections);
    }
  }
  return [...rows.entries()];
}
