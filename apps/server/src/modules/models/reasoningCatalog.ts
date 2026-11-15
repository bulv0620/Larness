import { z } from "zod";

export const effortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
type Effort = z.infer<typeof effortSchema>;
const effortLabels: Record<Effort, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最高",
};

export const catalogThinkingSchema = z.object({
  supported: z.boolean(),
  reasoning: z.boolean().optional(),
  mode: z.enum(["toggle", "levels", "mandatory-levels", "variants"]).optional(),
  defaultLevel: z.string().min(1).max(32).optional(),
  levels: z
    .array(z.object({ id: z.string().min(1).max(32), label: z.string().min(1).max(32) }))
    .max(12),
});
export type CatalogThinking = z.infer<typeof catalogThinkingSchema>;

export const publishedReasoningSchema = z.object({
  supported: z.boolean(),
  toggle: z.boolean().optional(),
  effort: z.array(z.string()).max(16).optional(),
  default: z.object({ type: z.string(), value: z.string() }).optional().catch(undefined),
});

export function effortThinking(
  values: readonly string[],
  defaultValue?: string,
  canDisable = false,
): CatalogThinking {
  const efforts = [...new Set([...(canDisable ? ["none"] : []), ...values])].flatMap((value) => {
    const result = effortSchema.safeParse(value);
    return result.success ? [result.data] : [];
  });
  if (efforts.length === 0) return { supported: false, reasoning: true, levels: [] };
  const levels = efforts.map((effort) => ({ id: `effort:${effort}`, label: effortLabels[effort] }));
  const defaultLevel = levels.find((level) => level.id === `effort:${defaultValue}`)?.id;
  if (defaultLevel === undefined) levels.unshift({ id: "effort:default", label: "默认" });
  return {
    supported: true,
    reasoning: true,
    mode: "variants",
    defaultLevel: defaultLevel ?? "effort:default",
    levels,
  };
}
