import { z } from "zod";
import { GO_OFFICIAL_SNAPSHOT } from "./goSnapshot.js";
import { effortThinking, publishedReasoningSchema } from "./reasoningCatalog.js";

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
        tools: z.object({ supported: z.boolean() }).optional().catch(undefined),
        reasoning: publishedReasoningSchema.optional().catch(undefined),
      })
      .optional(),
  })
  .passthrough();

const snapshotSchema = itemSchema.omit({ id: true });

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
      const official = goSnapshotEntry(item.id);
      const reasoning = item.capabilities?.reasoning;
      return [
        {
          ...item,
          context_window: item.limit?.context ?? item.context_window ?? official?.context_window,
          max_input_tokens:
            item.limit?.input ?? item.max_input_tokens ?? official?.max_input_tokens,
          max_output_tokens:
            item.limit?.output ?? item.max_output_tokens ?? official?.max_output_tokens,
          input_modalities:
            modalities(item.modalities?.input) ??
            item.input_modalities ??
            official?.input_modalities,
          output_modalities:
            modalities(item.modalities?.output) ??
            item.output_modalities ??
            official?.output_modalities,
          tool_calls:
            item.capabilities?.tools?.supported ?? item.tool_calls ?? official?.tool_calls,
          thinking: reasoning ? goThinking(reasoning) : (item.thinking ?? official?.thinking),
          snapshotFields: [
            ...(item.limit?.context === undefined && item.context_window === undefined
              ? ["contextWindow"]
              : []),
            ...(item.limit?.input === undefined && item.max_input_tokens === undefined
              ? ["maxInputTokens"]
              : []),
            ...(item.limit?.output === undefined && item.max_output_tokens === undefined
              ? ["maxOutputTokens"]
              : []),
            ...(item.modalities?.input === undefined && item.input_modalities === undefined
              ? ["inputModalities"]
              : []),
            ...(item.modalities?.output === undefined && item.output_modalities === undefined
              ? ["outputModalities"]
              : []),
            ...(item.capabilities?.tools === undefined && item.tool_calls === undefined
              ? ["tools"]
              : []),
            ...(reasoning === undefined && item.thinking === undefined ? ["thinking"] : []),
          ],
        },
      ];
    }),
  };
}

function goThinking(reasoning: z.infer<typeof publishedReasoningSchema>) {
  return reasoning.supported
    ? effortThinking(
        reasoning.effort ?? [],
        reasoning.default?.type === "effort" ? reasoning.default.value : undefined,
        reasoning.toggle,
      )
    : { supported: false, reasoning: false, levels: [] };
}

function goSnapshotEntry(id: string) {
  if (!Object.hasOwn(GO_OFFICIAL_SNAPSHOT, id)) return undefined;
  const entry = snapshotSchema.safeParse(GO_OFFICIAL_SNAPSHOT[id]);
  if (!entry.success) return undefined;
  const item = entry.data;
  const reasoning = item.capabilities?.reasoning;
  return {
    context_window: item.limit?.context,
    max_input_tokens: item.limit?.input,
    max_output_tokens: item.limit?.output,
    input_modalities: modalities(item.modalities?.input),
    output_modalities: modalities(item.modalities?.output),
    tool_calls: item.capabilities?.tools?.supported,
    thinking: reasoning ? goThinking(reasoning) : undefined,
  };
}

export function bundledGoThinking(id: string) {
  return goSnapshotEntry(id)?.thinking;
}
