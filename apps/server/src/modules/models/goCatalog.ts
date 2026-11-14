import { z } from "zod";

const itemSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    limit: z
      .object({
        context: z.number().optional(),
        input: z.number().optional(),
        output: z.number().optional(),
      })
      .optional(),
    modalities: z
      .object({ input: z.array(z.string()).optional(), output: z.array(z.string()).optional() })
      .optional(),
    capabilities: z
      .object({
        tools: z.object({ supported: z.boolean() }).optional(),
      })
      .optional(),
  })
  .passthrough();

function modalities(items: string[] | undefined): string[] | undefined {
  return items === undefined
    ? undefined
    : [
        ...new Set(
          items.map((item) => {
            const kind = item.split("/")[0];
            return kind === "text" || kind === "image" || kind === "video" || kind === "audio"
              ? kind
              : "file";
          }),
        ),
      ];
}

export function normalizeGoCatalog(payload: unknown): unknown {
  const response = z.object({ data: z.array(z.unknown()).max(200) }).safeParse(payload);
  if (!response.success) return payload;
  return {
    data: response.data.data.flatMap((raw) => {
      const entry = itemSchema.safeParse(raw);
      if (!entry.success) return [raw];
      const item = entry.data;
      if (item.type !== undefined && item.type !== "chat") return [];
      return [
        {
          ...item,
          context_window: item.limit?.context ?? item.context_window,
          max_input_tokens: item.limit?.input ?? item.max_input_tokens,
          max_output_tokens: item.limit?.output ?? item.max_output_tokens,
          input_modalities: modalities(item.modalities?.input) ?? item.input_modalities,
          output_modalities: modalities(item.modalities?.output) ?? item.output_modalities,
          tool_calls: item.capabilities?.tools?.supported ?? item.tool_calls,
        },
      ];
    }),
  };
}
