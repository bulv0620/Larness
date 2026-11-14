import type { ErrorCode } from "@larness/shared";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { CredentialProfileRow, ModelProviderId } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import {
  type CapabilityOverride,
  type CapabilitySources,
  capabilitySchema,
  type ModelCapabilities,
  readCapabilityOverrides,
  sourcesSchema,
  tokenLimitSchema,
} from "./capabilities.js";
import { assertSafeEndpoint, EndpointError, type HostResolver } from "./endpoint.js";
import { normalizeGoCatalog } from "./goCatalog.js";
import { presetForCredential } from "./presets.js";
import { fetchPublicModelDirectory, publicModels } from "./publicDirectory.js";
import {
  clearModelDefaultRow,
  findLatestCredentialForProvider,
  getCredentialRow,
  getModelCatalogCache,
  getModelDefaultRow,
  getModelVisibility,
  getSecretRow,
  listCredentialRows,
  recordModelCatalogFailure,
  saveModelCatalog,
  setModelDefaultRow,
  setModelVisibilityRow,
  updateCredentialRow,
} from "./repository.js";
import { ModelError } from "./service.js";

export const DEEPSEEK_CATALOG_URL = "https://api.deepseek.com/models";
export const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;

export type ThinkingEffort = "low" | "high" | "max";

export interface CatalogThinkingLevel {
  id: string;
  label: string;
}

export type CatalogThinkingMode = "toggle" | "levels" | "mandatory-levels";

export interface CatalogModel {
  id: string;
  label: string;
  contextWindow: number | null;
  thinking: { supported: boolean; mode?: CatalogThinkingMode; levels: CatalogThinkingLevel[] };
  capabilities?: ModelCapabilities;
  agentSelectable?: boolean;
  sources?: CapabilitySources;
  default: boolean;
  /** Whether the model appears in the conversation picker; defaults to true. */
  visible?: boolean;
}

export interface CatalogGroup {
  provider: ModelProviderId;
  credentialProfileId: string;
  credentialLabel: string;
  billing?: "usage" | "subscription" | "unknown";
  syncedAt: number | null;
  stale: boolean;
  lastRefreshError: string | null;
  directoryStatus?: "synced" | "unavailable";
  models: CatalogModel[];
}

export interface ModelDefaultSelection {
  model: string;
  thinking: string;
  credentialProfileId: string;
}

export interface CatalogDto extends CatalogGroup {
  /** Groups for every catalog-capable credential; flat fields mirror the latest group. */
  groups: CatalogGroup[];
  /** Global default for new sessions, if configured and still available. */
  defaultSelection: ModelDefaultSelection | null;
}

export interface CatalogSelection {
  model: string;
  thinking: string;
  contextWindow: number | null;
  credentialProfileId: string;
  provider: ModelProviderId;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  connectionRevision: number;
  connectionEndpoint: string | null;
  connectionSecretRef: string;
}

export interface CatalogOptions {
  db: Database;
  secretStore: SecretStore;
  now?: () => number;
  fetcher?: DeepSeekCatalogFetcher;
  timeoutMs?: number;
  endpointResolver?: HostResolver;
  publicDirectoryFetcher?: () => Promise<unknown>;
}

export type DeepSeekCatalogFetcher = (apiKey: string, signal: AbortSignal) => Promise<unknown>;

/** User-facing ladder. Provider canonical tiers are low / high / max. */
export const THINKING_LEVELS: readonly { id: "low" | "medium" | "high"; label: string }[] = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

const PROVIDER_EFFORT: Record<"low" | "medium" | "high", ThinkingEffort> = {
  low: "low",
  medium: "high",
  high: "max",
};

export const DEEPSEEK_BUILTIN_CATALOG: readonly CatalogModel[] = [
  {
    id: "deepseek-flash",
    label: "DeepSeek Flash",
    contextWindow: 1_048_576,
    thinking: {
      supported: true,
      mode: "levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: true,
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    contextWindow: 128_000,
    thinking: { supported: false, levels: [] },
    default: false,
  },
];

export const GLM_BUILTIN_CATALOG: readonly CatalogModel[] = [
  {
    id: "glm-4.6",
    label: "GLM-4.6",
    contextWindow: 200_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: true,
  },
  {
    id: "glm-4.7",
    label: "GLM-4.7",
    contextWindow: 200_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
  {
    id: "glm-5",
    label: "GLM-5",
    contextWindow: 200_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
  {
    id: "glm-5-turbo",
    label: "GLM-5-Turbo",
    contextWindow: 200_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
  {
    id: "glm-5.1",
    label: "GLM-5.1",
    contextWindow: 200_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
  {
    id: "glm-5.2",
    label: "GLM-5.2",
    contextWindow: 1_000_000,
    thinking: {
      supported: true,
      mode: "levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: false,
  },
  {
    id: "glm-5.3",
    label: "GLM-5.3",
    contextWindow: 1_000_000,
    thinking: {
      supported: true,
      mode: "mandatory-levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: false,
  },
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    contextWindow: 1_000_000,
    thinking: {
      supported: true,
      mode: "mandatory-levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: false,
  },
  {
    id: "glm-5.3-flashx",
    label: "GLM-5.3-FlashX",
    contextWindow: 1_000_000,
    thinking: {
      supported: true,
      mode: "mandatory-levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: false,
  },
  {
    id: "glm-5.3-flashx-legal",
    label: "GLM-5.3-FlashX-Legal",
    contextWindow: 1_000_000,
    thinking: {
      supported: true,
      mode: "mandatory-levels",
      levels: THINKING_LEVELS.map((level) => ({ ...level })),
    },
    default: false,
  },
  {
    id: "glm-4.5",
    label: "GLM-4.5",
    contextWindow: 128_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
  {
    id: "glm-4.5-air",
    label: "GLM-4.5-Air",
    contextWindow: 128_000,
    thinking: { supported: true, mode: "toggle", levels: [] },
    default: false,
  },
];

const levelSchema = z.object({
  id: z.string().min(1).max(32),
  label: z.string().min(1).max(32),
});

const upstreamModelSchema = z
  .object({
    id: z.string().min(1).max(128),
    name: z.string().min(1).max(128).optional(),
    context_window: z.unknown().optional(),
    contextWindow: z.unknown().optional(),
    max_input_tokens: z.unknown().optional(),
    max_output_tokens: z.unknown().optional(),
    input_modalities: z.unknown().optional(),
    output_modalities: z.unknown().optional(),
    tool_calls: z.unknown().optional(),
    streaming: z.unknown().optional(),
    effort: z
      .object({ supported_levels: z.array(z.string()).max(16) })
      .optional()
      .catch(undefined),
    thinking: z
      .object({
        supported: z.boolean().optional(),
        levels: z.array(levelSchema).max(8).optional(),
      })
      .optional(),
  })
  .passthrough();

const upstreamSchema = z
  .object({
    data: z.array(upstreamModelSchema).max(200),
  })
  .passthrough();

/** Thrown by the default fetcher; tests throw the same type to simulate upstream status codes. */
export class CatalogHttpError extends Error {
  readonly status: number;

  constructor(status: number, message = "catalog request failed") {
    super(message);
    this.name = "CatalogHttpError";
    this.status = status;
  }
}

function mapErrorCode(status: number): ErrorCode {
  if (status === 401 || status === 403) {
    return "PROVIDER_AUTH_FAILED";
  }

  if (status === 429) {
    return "PROVIDER_RATE_LIMITED";
  }

  if (status === 0 || status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }

  return "PROVIDER_UNKNOWN";
}

export function createDeepSeekCatalogFetcher(
  timeoutMs = DEFAULT_CATALOG_TIMEOUT_MS,
): DeepSeekCatalogFetcher {
  return async (apiKey, signal) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const forwardAbort = () => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });

    try {
      const response = await fetch(DEEPSEEK_CATALOG_URL, {
        method: "GET",
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CatalogHttpError(response.status);
      }

      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof CatalogHttpError) {
        throw error;
      }

      throw new CatalogHttpError(0, "catalog request failed");
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
    }
  };
}

// Go-specific limits for the initial offline snapshot. Only IDs the Go
// inventory actually returns are advertised.
const GO_BUILTIN_CATALOG: readonly CatalogModel[] = [
  {
    id: "glm-5.3-flash",
    label: "GLM-5.3-Flash",
    contextWindow: 1_000_000,
    capabilities: { tools: true, streaming: true, maxOutputTokens: 131_072 },
    thinking: { supported: false, levels: [] },
    default: false,
  },
  {
    id: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    contextWindow: 1_048_576,
    capabilities: { tools: true, streaming: true, maxOutputTokens: 393_216 },
    thinking: { supported: false, levels: [] },
    default: false,
  },
];

function builtinCatalog(provider: ModelProviderId): readonly CatalogModel[] {
  if (provider === "glm") return GLM_BUILTIN_CATALOG;
  if (provider === "opencode-go") return GO_BUILTIN_CATALOG;
  return provider === "deepseek" ? DEEPSEEK_BUILTIN_CATALOG : [];
}

function mergeCatalog(
  provider: ModelProviderId,
  payload: z.infer<typeof upstreamSchema>,
  fallbackWindow: number | null = null,
): CatalogModel[] {
  const builtins = builtinCatalog(provider);
  const models = payload.data.map((entry) => {
    const builtin = builtins.find((item) => item.id === entry.id);
    const hasUpstreamEffort = provider === "deepseek" && entry.effort !== undefined;
    const levels = hasUpstreamEffort
      ? THINKING_LEVELS.filter((level) =>
          entry.effort?.supported_levels.includes(PROVIDER_EFFORT[level.id]),
        )
      : THINKING_LEVELS;
    const supported = hasUpstreamEffort
      ? levels.length > 0
      : (entry.thinking?.supported ?? builtin?.thinking.supported ?? false);
    const mode = hasUpstreamEffort ? "levels" : (builtin?.thinking.mode ?? "levels");
    const thinking = { supported, mode, levels: supported && mode !== "toggle" ? [...levels] : [] };
    const upstreamWindow = tokenLimitSchema.safeParse(
      entry.context_window ?? entry.contextWindow,
    ).data;
    const contextWindow = upstreamWindow ?? builtin?.contextWindow ?? fallbackWindow;
    const sources: CapabilitySources = {};
    if (contextWindow !== null)
      sources.contextWindow =
        upstreamWindow !== undefined
          ? "upstream"
          : builtin?.contextWindow != null
            ? "bundled"
            : "legacy";
    if (hasUpstreamEffort || entry.thinking?.supported !== undefined) sources.thinking = "upstream";
    else if (builtin) sources.thinking = "bundled";

    const capabilities = {
      maxInputTokens: tokenLimitSchema.safeParse(entry.max_input_tokens).data,
      maxOutputTokens:
        tokenLimitSchema.safeParse(entry.max_output_tokens).data ??
        builtin?.capabilities?.maxOutputTokens,
      inputModalities: capabilitySchema.shape.inputModalities.safeParse(entry.input_modalities)
        .data,
      outputModalities: capabilitySchema.shape.outputModalities.safeParse(entry.output_modalities)
        .data,
      tools:
        capabilitySchema.shape.tools.safeParse(entry.tool_calls).data ??
        builtin?.capabilities?.tools,
      streaming:
        capabilitySchema.shape.streaming.safeParse(entry.streaming).data ??
        builtin?.capabilities?.streaming,
    };
    for (const key of Object.keys(capabilities) as (keyof ModelCapabilities)[]) {
      if (capabilities[key] !== undefined) sources[key] = "upstream";
    }
    if (
      builtin?.capabilities?.maxOutputTokens !== undefined &&
      !tokenLimitSchema.safeParse(entry.max_output_tokens).success
    )
      sources.maxOutputTokens = "bundled";
    if (capabilities.tools !== undefined && typeof entry.tool_calls !== "boolean")
      sources.tools = "bundled";
    if (capabilities.streaming !== undefined && typeof entry.streaming !== "boolean")
      sources.streaming = "bundled";

    return {
      id: entry.id,
      label: entry.name ?? builtin?.label ?? entry.id,
      contextWindow,
      capabilities,
      sources,
      thinking,
      default: false,
    };
  });

  const preferred = models.find((model) => model.id === "deepseek-flash") ?? models[0];

  return models.map((model) => ({ ...model, default: model === preferred }));
}

function parseModels(json: string): CatalogModel[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      const result = z
        .object({
          id: z.string(),
          label: z.string(),
          contextWindow: z.number().int().positive().nullable(),
          thinking: z.object({
            supported: z.boolean(),
            mode: z.enum(["toggle", "levels", "mandatory-levels"]).optional(),
            levels: z.array(levelSchema),
          }),
          capabilities: capabilitySchema.optional(),
          sources: sourcesSchema.optional(),
          default: z.boolean(),
        })
        .safeParse(entry);
      if (!result.success) {
        return [];
      }

      return [result.data];
    });
  } catch {
    return [];
  }
}

function catalogCredentials(db: DbExecutor) {
  return listCredentialRows(db).filter(
    (credential) =>
      presetForCredential(credential.provider, credential.endpoint) !== undefined &&
      (credential.provider !== "openai-compatible" || Boolean(credential.endpoint)),
  );
}

function groupFor(db: DbExecutor, credential: CredentialProfileRow): CatalogGroup {
  const row = getModelCatalogCache(db, credential.id);
  const visibility = getModelVisibility(db, credential.id);
  const models = modelsForCredential(db, credential).map((model) => ({
    ...model,
    visible: visibility.get(model.id) ?? true,
    agentSelectable: agentWindow(model) !== null,
  }));

  return {
    provider: credential.provider,
    credentialProfileId: credential.id,
    credentialLabel: credential.label,
    billing: presetForCredential(credential.provider, credential.endpoint)?.billing,
    syncedAt: row?.syncedAt ?? null,
    stale: row === null || row.syncedAt === null || row.lastErrorCode !== null,
    lastRefreshError: row?.lastErrorCode ?? null,
    models,
  };
}

export function getModelCatalog(options: CatalogOptions): CatalogDto {
  const credentials = catalogCredentials(options.db);

  if (credentials.length === 0) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a catalog credential first");
  }

  const groups = credentials.map((credential) => groupFor(options.db, credential));
  const row = getModelDefaultRow(options.db);
  const defaultGroup =
    row === null
      ? undefined
      : groups.find((group) => group.credentialProfileId === row.credentialProfileId);
  const defaultModel = defaultGroup?.models.find(
    (model) => model.id === row?.model && model.agentSelectable && model.visible !== false,
  );

  return {
    ...groups[0]!,
    groups,
    defaultSelection:
      row !== null && defaultModel !== undefined
        ? {
            model: row.model,
            thinking: row.thinking,
            credentialProfileId: row.credentialProfileId,
          }
        : null,
  };
}

function cachedModelsFor(db: DbExecutor, credentialId: string): CatalogModel[] {
  const row = getModelCatalogCache(db, credentialId);
  return row === null ? [] : parseModels(row.modelsJson);
}

function applyCapabilityOverride(model: CatalogModel, override: CapabilityOverride): CatalogModel {
  const { contextWindow, thinking, ...capabilities } = override;
  const sources = { ...model.sources };
  for (const key of Object.keys(override) as (keyof CapabilityOverride)[]) {
    sources[key] = "user";
  }
  return {
    ...model,
    sources,
    contextWindow: contextWindow ?? model.contextWindow,
    capabilities: { ...model.capabilities, ...capabilities },
    thinking:
      thinking === undefined
        ? model.thinking
        : {
            supported: thinking !== "off",
            ...(thinking === "off" ? {} : { mode: thinking }),
            levels:
              thinking === "levels" || thinking === "mandatory-levels" ? [...THINKING_LEVELS] : [],
          },
  };
}

function modelsForCredential(db: DbExecutor, credential: CredentialProfileRow): CatalogModel[] {
  const overrides = new Map(
    Object.entries(readCapabilityOverrides(credential.capabilityOverridesJson)),
  );
  const models = cachedModelsFor(db, credential.id).map((model) => {
    const override = overrides.get(model.id);
    overrides.delete(model.id);
    const fallbackWindow =
      credential.provider === "openai-compatible" ? credential.contextWindow : null;
    const withFallback: CatalogModel = {
      ...model,
      contextWindow: model.contextWindow ?? fallbackWindow,
      sources: {
        ...(model.contextWindow !== null || fallbackWindow !== null
          ? { contextWindow: "legacy" }
          : {}),
        ...model.sources,
      },
    };
    return override === undefined ? withFallback : applyCapabilityOverride(withFallback, override);
  });
  for (const [id, override] of overrides) {
    models.push(
      applyCapabilityOverride(
        {
          id,
          label: id,
          contextWindow: null,
          thinking: { supported: false, levels: [] },
          default: false,
        },
        override,
      ),
    );
  }
  return models;
}

export function setCatalogCapabilityOverride(
  options: CatalogOptions,
  input: {
    credentialProfileId: string;
    modelId: string;
    override: CapabilityOverride | null;
    clientSessionId?: string;
  },
): void {
  immediateTransaction(options.db, (tx) => {
    const credential = getCredentialRow(tx, input.credentialProfileId);
    if (credential === null) throw new ModelError("NOT_FOUND", "credential not found");
    const overrides = new Map(
      Object.entries(readCapabilityOverrides(credential.capabilityOverridesJson)),
    );
    if (input.override === null) overrides.delete(input.modelId);
    else {
      if (!overrides.has(input.modelId) && overrides.size >= 200) {
        throw new ModelError("VALIDATION_ERROR", "too many model overrides for this connection");
      }
      overrides.set(input.modelId, input.override);
    }
    updateCredentialRow(tx, {
      ...credential,
      capabilityOverridesJson: JSON.stringify(Object.fromEntries(overrides)),
    });
    appendAudit(tx, {
      action: "model.capabilities.changed",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "model",
      resourceId: input.modelId,
      details: { credentialProfileId: credential.id, fields: Object.keys(input.override ?? {}) },
      now: options.now?.() ?? Date.now(),
    });
  });
}

async function catalogPayload(
  options: CatalogOptions,
  provider: ModelProviderId,
  apiKey: string,
  endpoint?: string | null,
): Promise<unknown> {
  if (provider === "deepseek") {
    const fetcher =
      options.fetcher ??
      createDeepSeekCatalogFetcher(options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS);
    return fetcher(apiKey, new AbortController().signal);
  }

  if (provider === "openai-compatible") {
    await assertSafeEndpoint(endpoint ?? "", options.endpointResolver);
  }
  const url = catalogUrl(provider, endpoint ?? null);
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) throw new CatalogHttpError(response.status);
  return (await response.json()) as unknown;
}

function catalogUrl(provider: ModelProviderId, endpoint: string | null): string {
  if (provider === "deepseek") return DEEPSEEK_CATALOG_URL;
  const preset = presetForCredential(provider, endpoint);
  if (!preset) throw new ModelError("VALIDATION_ERROR", "unsupported connection endpoint");
  if (preset.catalogUrl) return preset.catalogUrl;
  const base = endpoint ?? preset.endpoint;
  if (!base) throw new ModelError("VALIDATION_ERROR", "connection endpoint is missing");
  return `${base}/models`;
}

async function refreshCredential(
  options: CatalogOptions,
  credential: CredentialProfileRow,
  clientSessionId: string | undefined,
  directory: unknown,
): Promise<void> {
  if (getCredentialRow(options.db, credential.id)?.revision !== credential.revision) return;
  const now = options.now?.() ?? Date.now();
  const secret = getSecretRow(options.db, credential.secretRef);

  if (secret === null) {
    recordFailure(options, credential, "PROVIDER_AUTH_FAILED", now);
    return;
  }

  let apiKey: string;

  try {
    apiKey = options.secretStore.decrypt(secret);
  } catch {
    recordFailure(options, credential, "PROVIDER_AUTH_FAILED", now);
    return;
  }

  let payload: unknown;

  try {
    payload = await catalogPayload(options, credential.provider, apiKey, credential.endpoint);
  } catch (error) {
    const code =
      error instanceof CatalogHttpError
        ? mapErrorCode(error.status)
        : error instanceof ModelError
          ? error.code
          : error instanceof EndpointError
            ? "VALIDATION_ERROR"
            : "PROVIDER_UNAVAILABLE";
    recordFailure(options, credential, code, now);
    return;
  }

  const parsed = upstreamSchema.safeParse(
    credential.provider === "opencode-go" ? normalizeGoCatalog(payload) : payload,
  );

  if (!parsed.success) {
    recordFailure(options, credential, "MODEL_CATALOG_INVALID", now);
    return;
  }

  const models = mergeCatalog(
    credential.provider,
    parsed.data,
    credential.provider === "openai-compatible" ? (credential.contextWindow ?? 128_000) : null,
  );

  const previous = new Map(
    cachedModelsFor(options.db, credential.id).map((model) => [model.id, model]),
  );
  for (const model of models) {
    const cached = previous.get(model.id);
    if (
      cached?.sources?.contextWindow === "directory" &&
      model.sources?.contextWindow !== "upstream"
    ) {
      model.contextWindow = cached.contextWindow;
      model.sources = { ...model.sources, contextWindow: "directory" };
    }
    for (const key of Object.keys(cached?.capabilities ?? {}) as (keyof ModelCapabilities)[]) {
      if (cached?.sources?.[key] === "directory" && model.sources?.[key] !== "upstream") {
        model.capabilities = { ...model.capabilities, [key]: cached.capabilities?.[key] };
        model.sources = { ...model.sources, [key]: "directory" };
      }
    }
  }
  supplementFromPublicDirectory(models, credential, directory);

  if (models.length === 0) {
    recordFailure(options, credential, "MODEL_CATALOG_INVALID", now);
    return;
  }

  immediateTransaction(options.db, (tx) => {
    if (getCredentialRow(tx, credential.id)?.revision !== credential.revision) return;
    if ((getModelCatalogCache(tx, credential.id)?.lastAttemptAt ?? -1) > now) return;
    saveModelCatalog(tx, {
      credentialProfileId: credential.id,
      provider: credential.provider,
      endpoint: catalogUrl(credential.provider, credential.endpoint),
      modelsJson: JSON.stringify(models),
      now,
    });
    appendAudit(tx, {
      action: "model.catalog.refreshed",
      decision: "allow",
      clientSessionId,
      resourceType: "model_catalog",
      resourceId: credential.id,
      details: { provider: credential.provider, modelCount: models.length },
      now,
    });
  });
}

const publicProviderIds = new Map([
  ["deepseek-api", "deepseek"],
  ["glm-standard-cn", "zhipuai"],
  ["glm-coding-cn", "zhipuai-coding-plan"],
  ["glm-standard-intl", "zai"],
  ["glm-coding-intl", "zai-coding-plan"],
]);

function supplementFromPublicDirectory(
  models: CatalogModel[],
  credential: CredentialProfileRow,
  payload: unknown,
): void {
  const preset = presetForCredential(credential.provider, credential.endpoint);
  const provider =
    preset?.directoryId ?? (preset === undefined ? undefined : publicProviderIds.get(preset.id));
  if (provider === undefined) return;
  const directory = publicModels(payload, provider);
  for (const model of models) {
    const entry = directory.get(model.id);
    if (entry === undefined) continue;
    const sources: CapabilitySources = { ...model.sources };
    if (entry.limit?.context !== undefined && sources.contextWindow !== "upstream") {
      model.contextWindow = entry.limit.context;
      sources.contextWindow = "directory";
    }
    const fromDirectory: ModelCapabilities = {
      maxInputTokens: entry.limit?.input,
      maxOutputTokens: entry.limit?.output,
      inputModalities: entry.modalities?.input,
      outputModalities: entry.modalities?.output,
      tools: entry.tool_call,
    };
    const capabilities = { ...model.capabilities };
    for (const key of Object.keys(fromDirectory) as (keyof ModelCapabilities)[]) {
      if (fromDirectory[key] !== undefined && sources[key] !== "upstream") {
        Object.assign(capabilities, { [key]: fromDirectory[key] });
        sources[key] = "directory";
      }
    }
    model.capabilities = capabilities;
    model.sources = sources;
  }
}

export async function refreshModelCatalog(
  options: CatalogOptions,
  input: {
    clientSessionId?: string;
    credentialProfileId?: string;
    includePublicDirectory?: boolean;
  } = {},
): Promise<CatalogDto> {
  const credentials =
    input.credentialProfileId === undefined
      ? catalogCredentials(options.db)
      : (() => {
          const credential = getCredentialRow(options.db, input.credentialProfileId as string);
          if (credential === null) {
            throw new ModelError("NOT_FOUND", "credential not found");
          }
          if (!presetForCredential(credential.provider, credential.endpoint)) {
            throw new ModelError("MODEL_UNSUPPORTED", "catalog is not available for this provider");
          }
          return [credential];
        })();

  if (credentials.length === 0) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a catalog credential first");
  }

  let directory: unknown;
  let directoryStatus: "synced" | "unavailable" | undefined;
  if (input.includePublicDirectory === true) {
    try {
      directory = await (options.publicDirectoryFetcher ?? fetchPublicModelDirectory)();
      if (typeof directory !== "object" || directory === null || Array.isArray(directory)) {
        throw new Error("invalid public model directory");
      }
      directoryStatus = "synced";
    } catch {
      directoryStatus = "unavailable";
    }
  }
  for (const credential of credentials) {
    await refreshCredential(options, credential, input.clientSessionId, directory);
  }

  const catalog = getModelCatalog(options);
  return directoryStatus === undefined ? catalog : { ...catalog, directoryStatus };
}

function recordFailure(
  options: CatalogOptions,
  credential: { id: string; provider: ModelProviderId; endpoint: string | null; revision: number },
  errorCode: string,
  now: number,
): void {
  immediateTransaction(options.db, (tx) => {
    if (getCredentialRow(tx, credential.id)?.revision !== credential.revision) return;
    if ((getModelCatalogCache(tx, credential.id)?.lastAttemptAt ?? -1) > now) return;
    recordModelCatalogFailure(tx, {
      credentialProfileId: credential.id,
      provider: credential.provider,
      endpoint: catalogUrl(credential.provider, credential.endpoint),
      errorCode,
      now,
    });
  });
}

export function defaultThinking(model: CatalogModel): string {
  if (!model.thinking.supported) return "off";
  if (model.thinking.mode === "toggle") return "on";
  const preferred = model.thinking.mode === "mandatory-levels" ? "high" : "medium";
  return (
    model.thinking.levels.find((level) => level.id === preferred)?.id ??
    model.thinking.levels[0]?.id ??
    "off"
  );
}

function normalizeThinking(model: CatalogModel, thinking: string | null | undefined): string {
  if (!model.thinking.supported) {
    if (thinking === undefined || thinking === null || thinking === "" || thinking === "off") {
      return "off";
    }
    throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
  }

  const mode = model.thinking.mode ?? "levels";

  if (thinking === undefined || thinking === null || thinking.length === 0) {
    return defaultThinking(model);
  }

  if (mode === "toggle") {
    if (thinking === "off") return "off";
    if (thinking === "on") return "on";
    // Legacy level/default values collapse to "on" for toggle-only models.
    if (["low", "medium", "high", "default"].includes(thinking)) return "on";
    throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
  }

  if (thinking === "default" || thinking === "on") return defaultThinking(model);
  if (thinking === "off" && mode !== "mandatory-levels") return "off";
  if (model.thinking.levels.some((level) => level.id === thinking)) return thinking;
  if (mode === "mandatory-levels")
    throw new ModelError("MODEL_UNSUPPORTED", "this model requires a thinking level");
  throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
}

function agentWindow(model: CatalogModel): number | null {
  return model.capabilities?.tools === false || model.capabilities?.streaming === false
    ? null
    : (model.contextWindow ?? model.capabilities?.maxInputTokens ?? null);
}

export function resolveCatalogSelection(
  db: DbExecutor,
  input: { model: string; thinking?: string | null; credentialProfileId?: string | null },
): CatalogSelection {
  const credentials = catalogCredentials(db);

  if (credentials.length === 0) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a catalog credential first");
  }

  let credential: (typeof credentials)[number] | undefined = credentials[0];
  let model: CatalogModel | undefined;

  if (input.credentialProfileId !== undefined && input.credentialProfileId !== null) {
    credential = credentials.find((item) => item.id === input.credentialProfileId);

    if (credential === undefined) {
      throw new ModelError("MODEL_UNSUPPORTED", "credential is not available in the catalog");
    }

    model = modelsForCredential(db, credential).find((item) => item.id === input.model);
  } else {
    const matches = credentials.flatMap((item) =>
      modelsForCredential(db, item)
        .filter((candidate) => candidate.id === input.model)
        .map((candidate) => ({ credential: item, model: candidate })),
    );

    if (matches.length > 1) {
      throw new ModelError(
        "MODEL_UNSUPPORTED",
        "model exists in multiple credentials; select a key",
      );
    }

    credential = matches[0]?.credential ?? credential;
    model = matches[0]?.model;
  }

  const contextWindow = model === undefined ? null : agentWindow(model);
  if (credential === undefined || model === undefined || contextWindow === null) {
    throw new ModelError(
      "MODEL_UNSUPPORTED",
      "model needs a known context or input limit and must support streaming tool calls",
    );
  }

  return {
    model: model.id,
    thinking: normalizeThinking(model, input.thinking),
    contextWindow,
    credentialProfileId: credential.id,
    provider: credential.provider,
    ...(model.capabilities?.maxInputTokens === undefined
      ? {}
      : { maxInputTokens: model.capabilities.maxInputTokens }),
    ...(model.capabilities?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: model.capabilities.maxOutputTokens }),
    connectionRevision: credential.revision,
    connectionEndpoint: credential.endpoint,
    connectionSecretRef: credential.secretRef,
  };
}

export interface ResolvedCatalogProvider {
  provider: ModelProviderId;
  model: string;
  apiKey: string;
  endpoint?: string;
  contextWindow: number;
  thinking: { enabled: boolean; effort?: ThinkingEffort };
}

export function mapThinkingSetting(thinking: string | null | undefined): {
  enabled: boolean;
  effort?: ThinkingEffort;
} {
  if (thinking === "off") {
    return { enabled: false };
  }

  if (thinking === "low" || thinking === "medium" || thinking === "high") {
    return { enabled: true, effort: PROVIDER_EFFORT[thinking] };
  }

  if (thinking === "on") {
    return { enabled: true };
  }

  // "default" is a legacy stored value; treat it as the middle tier.
  return { enabled: true, effort: PROVIDER_EFFORT.medium };
}

export function resolveCatalogProvider(
  options: CatalogOptions,
  input: {
    model: string;
    thinking: string | null;
    credentialProfileId?: string | null;
    snapshot?: {
      provider: ModelProviderId;
      endpoint: string | null;
      secretRef: string;
      contextWindow: number;
    };
  },
): ResolvedCatalogProvider {
  const credential =
    input.snapshot ??
    (input.credentialProfileId != null
      ? getCredentialRow(options.db, input.credentialProfileId)
      : findLatestCredentialForProvider(options.db, "deepseek"));

  if (credential === null) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a catalog credential first");
  }

  const secret = getSecretRow(options.db, credential.secretRef);

  if (secret === null) {
    throw new ModelError("PROVIDER_AUTH_FAILED", "credential secret is missing");
  }

  let apiKey: string;

  try {
    apiKey = options.secretStore.decrypt(secret);
  } catch {
    throw new ModelError("PROVIDER_AUTH_FAILED", "credential cannot be decrypted");
  }

  const contextWindow =
    "id" in credential
      ? (modelsForCredential(options.db, credential).find((item) => item.id === input.model)
          ?.contextWindow ??
        builtinCatalog(credential.provider).find((item) => item.id === input.model)
          ?.contextWindow ??
        null)
      : credential.contextWindow;

  if (contextWindow === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the official catalog");
  }

  return {
    provider: credential.provider,
    model: input.model,
    apiKey,
    ...(credential.endpoint === null || credential.endpoint === undefined
      ? {}
      : { endpoint: credential.endpoint }),
    contextWindow,
    thinking: mapThinkingSetting(input.thinking),
  };
}

export function setCatalogModelVisibility(
  options: CatalogOptions,
  input: {
    credentialProfileId: string;
    modelId: string;
    visible: boolean;
    clientSessionId?: string;
  },
): void {
  const credential = getCredentialRow(options.db, input.credentialProfileId);

  if (credential === null) {
    throw new ModelError("NOT_FOUND", "credential not found");
  }

  if (!modelsForCredential(options.db, credential).some((model) => model.id === input.modelId)) {
    throw new ModelError("NOT_FOUND", "model is not in the catalog");
  }

  const now = options.now?.() ?? Date.now();
  immediateTransaction(options.db, (tx) => {
    const currentDefault = getModelDefaultRow(tx);
    if (
      currentDefault?.credentialProfileId === credential.id &&
      currentDefault.model === input.modelId &&
      (!input.visible || getModelVisibility(tx, credential.id).get(input.modelId) === false)
    ) {
      clearModelDefaultRow(tx);
      appendAudit(tx, {
        action: "model.default.changed",
        decision: "allow",
        clientSessionId: input.clientSessionId,
        resourceType: "model",
        resourceId: input.modelId,
        details: { credentialProfileId: credential.id, cleared: true },
        now,
      });
    }

    setModelVisibilityRow(tx, {
      credentialProfileId: credential.id,
      modelId: input.modelId,
      visible: input.visible,
      now,
    });
    appendAudit(tx, {
      action: "model.visibility.changed",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "model",
      resourceId: input.modelId,
      details: { credentialProfileId: credential.id, visible: input.visible },
      now,
    });
  });
}

export function getModelDefaultSelection(db: DbExecutor): ModelDefaultSelection | null {
  const row = getModelDefaultRow(db);

  if (row === null || getModelVisibility(db, row.credentialProfileId).get(row.model) === false) {
    return null;
  }

  try {
    const selection = resolveCatalogSelection(db, {
      model: row.model,
      thinking: row.thinking,
      credentialProfileId: row.credentialProfileId,
    });

    return {
      model: selection.model,
      thinking: selection.thinking,
      credentialProfileId: selection.credentialProfileId,
    };
  } catch {
    return null;
  }
}

export function setCatalogDefault(
  options: CatalogOptions,
  input: {
    model: string;
    credentialProfileId: string;
    thinking?: string;
    clientSessionId?: string;
  },
): ModelDefaultSelection {
  const credential = getCredentialRow(options.db, input.credentialProfileId);

  if (credential === null) {
    throw new ModelError("NOT_FOUND", "credential not found");
  }

  const groupModels = modelsForCredential(options.db, credential);
  const model = groupModels.find((item) => item.id === input.model);

  if (model === undefined || agentWindow(model) === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the catalog");
  }

  const thinking = normalizeThinking(model, input.thinking ?? defaultThinking(model));
  const now = options.now?.() ?? Date.now();

  immediateTransaction(options.db, (tx) => {
    if (getModelVisibility(tx, credential.id).get(model.id) === false) {
      throw new ModelError("MODEL_UNSUPPORTED", "hidden models cannot be set as the default");
    }

    setModelDefaultRow(tx, {
      credentialProfileId: input.credentialProfileId,
      model: model.id,
      thinking,
      now,
    });
    appendAudit(tx, {
      action: "model.default.changed",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "model",
      resourceId: model.id,
      details: { credentialProfileId: input.credentialProfileId, thinking },
      now,
    });
  });

  return { model: model.id, thinking, credentialProfileId: input.credentialProfileId };
}
