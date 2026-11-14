import { z } from "zod";
import { capabilitySchema, tokenLimitSchema } from "./capabilities.js";

const URL = "https://models.dev/api.json";
const MAX_BYTES = 16 * 1024 * 1024;

const entrySchema = z.object({
  limit: z
    .object({
      context: tokenLimitSchema.optional().catch(undefined),
      input: tokenLimitSchema.optional().catch(undefined),
      output: tokenLimitSchema.optional().catch(undefined),
    })
    .optional(),
  modalities: z
    .object({
      input: capabilitySchema.shape.inputModalities.catch(undefined),
      output: capabilitySchema.shape.outputModalities.catch(undefined),
    })
    .optional(),
  tool_call: z.boolean().optional(),
});
const providerSchema = z.object({ models: z.record(z.string(), z.unknown()) });

export function publicModels(payload: unknown, provider: string) {
  if (typeof payload !== "object" || payload === null || !Object.hasOwn(payload, provider)) {
    return new Map<string, z.infer<typeof entrySchema>>();
  }
  const parsed = providerSchema.safeParse((payload as Record<string, unknown>)[provider]);
  const result = new Map<string, z.infer<typeof entrySchema>>();
  if (parsed.success) {
    for (const [id, value] of Object.entries(parsed.data.models)) {
      const entry = entrySchema.safeParse(value);
      if (entry.success) result.set(id, entry.data);
    }
  }
  return result;
}

export async function fetchPublicModelDirectory(): Promise<unknown> {
  const response = await fetch(URL, {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || response.body === null) throw new Error("model directory unavailable");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let json = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(json + decoder.decode()) as unknown;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("model directory exceeds size limit");
      json += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
