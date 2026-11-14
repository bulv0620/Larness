import { z } from "zod";
import { capabilitySchema } from "./capabilities.js";

const pageSchema = z.object({
  output: z.object({
    total: z.number().int().nonnegative(),
    page_size: z.number().int().positive(),
    models: z
      .array(
        z.object({
          model: z.string(),
          name: z.string().optional(),
          model_info: z
            .object({
              context_window: z.unknown().optional(),
              max_input_tokens: z.unknown().optional(),
              max_output_tokens: z.unknown().optional(),
            })
            .optional(),
          inference_metadata: z
            .object({
              request_modality: z.array(z.string()).optional(),
              response_modality: z.array(z.string()).optional(),
            })
            .optional(),
          features: z.array(z.string()).optional(),
        }),
      )
      .max(200),
  }),
});

function modalities(input: string[] | undefined) {
  return capabilitySchema.shape.inputModalities.safeParse(input?.map((item) => item.toLowerCase()))
    .data;
}

export async function bailianWorkspaceCatalog(
  base: URL,
  fetchPage: (url: string) => Promise<unknown>,
): Promise<unknown> {
  const data = [];
  const pages = 10;
  for (let page = 1; page <= pages && data.length < 200; page++) {
    const url = new URL("/api/v1/models", base);
    url.searchParams.set("page_no", String(page));
    url.searchParams.set("page_size", "20");
    const parsed = pageSchema.safeParse(await fetchPage(url.toString()));
    if (!parsed.success) return null;
    const output = parsed.data.output;
    for (const model of output.models) {
      data.push({
        id: model.model,
        name: model.name,
        ...model.model_info,
        input_modalities: modalities(model.inference_metadata?.request_modality),
        output_modalities: modalities(model.inference_metadata?.response_modality),
        tool_calls: model.features?.includes("function-calling"),
      });
    }
    if (page * output.page_size >= output.total || output.models.length === 0) break;
  }
  return { data: data.slice(0, 200) };
}
