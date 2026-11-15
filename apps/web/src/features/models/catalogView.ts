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
