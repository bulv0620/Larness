import type { SessionRow, TurnRow } from "../../db/schema.js";
import type { ResolvedProvider } from "../agent/turnRunner.js";
import { type CatalogOptions, resolveCatalogSelection } from "./catalog.js";
import { ModelError } from "./service.js";

export type ModelProbeResolver = (
  session: Pick<SessionRow, "id" | "modelProfileId">,
  turn: Pick<
    TurnRow,
    | "model"
    | "thinking"
    | "provider"
    | "contextWindow"
    | "credentialProfileId"
    | "connectionRevision"
    | "connectionEndpoint"
    | "connectionSecretRef"
    | "maxInputTokens"
    | "maxOutputTokens"
    | "modelProfileId"
  >,
) => ResolvedProvider | Promise<ResolvedProvider>;

export async function probeModelConnection(
  options: CatalogOptions,
  resolver: ModelProbeResolver,
  input: { credentialProfileId: string; model: string },
): Promise<void> {
  const selection = resolveCatalogSelection(options.db, input);
  const signal = AbortSignal.timeout(12_000);
  const resolved = await resolver(
    // The normal catalog resolver reads these snapshot fields. A probe never
    // participates in the workspace or the user's conversation history.
    { id: "model-connection-probe", modelProfileId: null },
    {
      model: selection.model,
      thinking: selection.thinking,
      provider: selection.provider,
      contextWindow: selection.contextWindow,
      credentialProfileId: selection.credentialProfileId,
      connectionRevision: selection.connectionRevision,
      connectionEndpoint: selection.connectionEndpoint,
      connectionSecretRef: selection.connectionSecretRef,
      maxInputTokens: selection.maxInputTokens ?? null,
      maxOutputTokens: selection.maxOutputTokens ?? null,
      modelProfileId: null,
    },
  );
  for await (const chunk of resolved.adapter.streamStep({
    model: resolved.model,
    messages: [{ role: "user", content: "Reply with OK." }],
    tools: [],
    signal,
    timeoutMs: 12_000,
    maxRetries: 0,
    maxOutputTokens: Math.min(resolved.maxOutputTokens ?? 64, 64),
    apiKey: resolved.apiKey,
    endpoint: resolved.endpoint,
    thinking: resolved.thinking,
  })) {
    if (chunk.type === "error") {
      throw new ModelError(
        chunk.error.code === "PROVIDER_ABORTED" ? "PROVIDER_UNAVAILABLE" : chunk.error.code,
        "Model test failed",
      );
    }
    if (
      chunk.type === "finish" &&
      (chunk.finishReason === "stop" || chunk.finishReason === "length")
    )
      return;
  }
  throw new ModelError("PROVIDER_UNKNOWN", "Model test did not complete");
}
