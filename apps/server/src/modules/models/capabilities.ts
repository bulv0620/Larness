import { z } from "zod";

export const tokenLimitSchema = z.number().int().positive().max(100_000_000);
const modalitiesSchema = z.array(z.enum(["text", "image", "audio", "video", "file"])).max(5);
export const capabilitySchema = z.object({
  maxInputTokens: tokenLimitSchema.optional(),
  maxOutputTokens: tokenLimitSchema.optional(),
  inputModalities: modalitiesSchema.optional(),
  outputModalities: modalitiesSchema.optional(),
  tools: z.boolean().optional(),
  streaming: z.boolean().optional(),
});
export type ModelCapabilities = z.infer<typeof capabilitySchema>;

export const overrideSchema = capabilitySchema
  .extend({
    contextWindow: tokenLimitSchema.optional(),
    thinking: z.enum(["off", "toggle", "levels", "mandatory-levels"]).optional(),
  })
  .strict();
export type CapabilityOverride = z.infer<typeof overrideSchema>;

export const sourcesSchema = z.partialRecord(
  z.enum([
    "contextWindow",
    "thinking",
    ...(Object.keys(capabilitySchema.shape) as (keyof ModelCapabilities)[]),
  ]),
  z.enum(["upstream", "bundled", "directory", "user", "legacy"]),
);
export type CapabilitySources = z.infer<typeof sourcesSchema>;

const overridesSchema = z.record(z.string(), overrideSchema);
export function readCapabilityOverrides(json: string): Record<string, CapabilityOverride> {
  try {
    const parsed = overridesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
