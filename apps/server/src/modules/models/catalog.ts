import { GLM_BASE_URL } from "@larness/agent";
import type { ErrorCode } from "@larness/shared";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ModelProviderId } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import {
  findLatestCredentialForProvider,
  getCredentialRow,
  getModelCatalogCache,
  getModelVisibility,
  getSecretRow,
  listCredentialRows,
  recordModelCatalogFailure,
  saveModelCatalog,
  setModelVisibilityRow,
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
  default: boolean;
  /** Whether the model appears in the conversation picker; defaults to true. */
  visible?: boolean;
}

export interface CatalogGroup {
  provider: ModelProviderId;
  credentialProfileId: string;
  credentialLabel: string;
  syncedAt: number | null;
  stale: boolean;
  lastRefreshError: string | null;
  models: CatalogModel[];
}

export interface CatalogDto extends CatalogGroup {
  /** Groups for every catalog-capable credential; flat fields mirror the latest group. */
  groups: CatalogGroup[];
}

export interface CatalogSelection {
  model: string;
  thinking: string;
  contextWindow: number | null;
  credentialProfileId: string;
}

export interface CatalogOptions {
  db: Database;
  secretStore: SecretStore;
  now?: () => number;
  fetcher?: DeepSeekCatalogFetcher;
  timeoutMs?: number;
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
    thinking: { supported: false, levels: [] },
    default: true,
  },
  {
    id: "glm-4.5",
    label: "GLM-4.5",
    contextWindow: 128_000,
    thinking: { supported: false, levels: [] },
    default: false,
  },
  {
    id: "glm-4.5-air",
    label: "GLM-4.5 Air",
    contextWindow: 128_000,
    thinking: { supported: false, levels: [] },
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
    context_window: z.number().int().positive().max(100_000_000).optional(),
    contextWindow: z.number().int().positive().max(100_000_000).optional(),
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

function builtinCatalog(provider: ModelProviderId): readonly CatalogModel[] {
  return provider === "glm" ? GLM_BUILTIN_CATALOG : DEEPSEEK_BUILTIN_CATALOG;
}

function mergeCatalog(
  provider: ModelProviderId,
  payload: z.infer<typeof upstreamSchema>,
): CatalogModel[] {
  const builtins = builtinCatalog(provider);
  const models = payload.data.map((entry) => {
    const builtin = builtins.find((item) => item.id === entry.id);
    const supported = entry.thinking?.supported ?? builtin?.thinking.supported ?? false;
    const mode = builtin?.thinking.mode ?? "levels";
    const levels = supported
      ? mode === "toggle"
        ? []
        : THINKING_LEVELS.map((level) => ({ ...level }))
      : [];
    const thinking = { supported, mode, levels };

    return {
      id: entry.id,
      label: entry.name ?? builtin?.label ?? entry.id,
      contextWindow: entry.context_window ?? entry.contextWindow ?? builtin?.contextWindow ?? null,
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
          default: z.boolean(),
        })
        .safeParse(entry);
      if (!result.success) {
        return [];
      }

      return [
        {
          ...result.data,
          thinking: result.data.thinking.supported
            ? {
                supported: true,
                mode: result.data.thinking.mode ?? "levels",
                levels:
                  (result.data.thinking.mode ?? "levels") === "toggle"
                    ? []
                    : THINKING_LEVELS.map((level) => ({ ...level })),
              }
            : { supported: false, levels: [] },
        },
      ];
    });
  } catch {
    return [];
  }
}

function catalogCredentials(db: DbExecutor) {
  return listCredentialRows(db).filter(
    (credential) => credential.provider === "deepseek" || credential.provider === "glm",
  );
}

function groupFor(
  db: DbExecutor,
  credential: { id: string; label: string; provider: ModelProviderId },
): CatalogGroup {
  const row = getModelCatalogCache(db, credential.id);

  const visibility = getModelVisibility(db, credential.id);
  const models = (row === null ? [] : parseModels(row.modelsJson)).map((model) => ({
    ...model,
    visible: visibility.get(model.id) ?? true,
  }));

  return {
    provider: credential.provider,
    credentialProfileId: credential.id,
    credentialLabel: credential.label,
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
  return { ...groups[0]!, groups };
}

function cachedModelsFor(db: DbExecutor, credentialId: string): CatalogModel[] {
  const row = getModelCatalogCache(db, credentialId);
  return row === null ? [] : parseModels(row.modelsJson);
}

async function catalogPayload(
  options: CatalogOptions,
  provider: ModelProviderId,
  apiKey: string,
): Promise<unknown> {
  if (provider === "deepseek") {
    const fetcher =
      options.fetcher ??
      createDeepSeekCatalogFetcher(options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS);
    return fetcher(apiKey, new AbortController().signal);
  }

  if (provider === "glm") {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${GLM_BASE_URL}/models`, {
        headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new CatalogHttpError(response.status);
      }

      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ModelError("MODEL_UNSUPPORTED", "catalog is not available for this provider");
}

async function refreshCredential(
  options: CatalogOptions,
  credential: { id: string; label: string; provider: ModelProviderId; secretRef: string },
  clientSessionId: string | undefined,
): Promise<void> {
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
    payload = await catalogPayload(options, credential.provider, apiKey);
  } catch (error) {
    const code =
      error instanceof CatalogHttpError
        ? mapErrorCode(error.status)
        : error instanceof ModelError
          ? error.code
          : "PROVIDER_UNAVAILABLE";
    recordFailure(options, credential, code, now);
    return;
  }

  const parsed = upstreamSchema.safeParse(payload);

  if (!parsed.success) {
    recordFailure(options, credential, "MODEL_CATALOG_INVALID", now);
    return;
  }

  const models = mergeCatalog(credential.provider, parsed.data);

  if (models.length === 0) {
    recordFailure(options, credential, "MODEL_CATALOG_INVALID", now);
    return;
  }

  immediateTransaction(options.db, (tx) => {
    saveModelCatalog(tx, {
      credentialProfileId: credential.id,
      provider: credential.provider,
      endpoint: credential.provider === "glm" ? `${GLM_BASE_URL}/models` : DEEPSEEK_CATALOG_URL,
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

export async function refreshModelCatalog(
  options: CatalogOptions,
  input: { clientSessionId?: string; credentialProfileId?: string } = {},
): Promise<CatalogDto> {
  const credentials =
    input.credentialProfileId === undefined
      ? catalogCredentials(options.db)
      : (() => {
          const credential = getCredentialRow(options.db, input.credentialProfileId as string);
          if (credential === null) {
            throw new ModelError("NOT_FOUND", "credential not found");
          }
          if (credential.provider !== "deepseek" && credential.provider !== "glm") {
            throw new ModelError("MODEL_UNSUPPORTED", "catalog is not available for this provider");
          }
          return [credential];
        })();

  if (credentials.length === 0) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a catalog credential first");
  }

  for (const credential of credentials) {
    await refreshCredential(options, credential, input.clientSessionId);
  }

  return getModelCatalog(options);
}

function recordFailure(
  options: CatalogOptions,
  credential: { id: string; provider: ModelProviderId },
  errorCode: string,
  now: number,
): void {
  immediateTransaction(options.db, (tx) => {
    recordModelCatalogFailure(tx, {
      credentialProfileId: credential.id,
      provider: credential.provider,
      endpoint: credential.provider === "glm" ? `${GLM_BASE_URL}/models` : DEEPSEEK_CATALOG_URL,
      errorCode,
      now,
    });
  });
}

export function defaultThinking(model: CatalogModel): string {
  if (!model.thinking.supported) return "off";
  if (model.thinking.mode === "toggle") return "on";
  if (model.thinking.mode === "mandatory-levels") return "high";
  return "medium";
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

  if (mode === "mandatory-levels") {
    if (["low", "medium", "high"].includes(thinking)) return thinking;
    if (thinking === "default" || thinking === "on") return "high";
    throw new ModelError("MODEL_UNSUPPORTED", "this model requires a thinking level");
  }

  if (thinking === "off") return "off";
  if (thinking === "default" || thinking === "on") return "medium";
  if (["low", "medium", "high"].includes(thinking)) return thinking;
  throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
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

    model = cachedModelsFor(db, credential.id).find((item) => item.id === input.model);
  } else {
    const matches = credentials.flatMap((item) =>
      cachedModelsFor(db, item.id)
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

  if (credential === undefined || model === undefined || model.contextWindow === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the official catalog");
  }

  return {
    model: model.id,
    thinking: normalizeThinking(model, input.thinking),
    contextWindow: model.contextWindow,
    credentialProfileId: credential.id,
  };
}

export interface ResolvedCatalogProvider {
  provider: ModelProviderId;
  model: string;
  apiKey: string;
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
  input: { model: string; thinking: string | null; credentialProfileId?: string | null },
): ResolvedCatalogProvider {
  const credential =
    input.credentialProfileId !== undefined && input.credentialProfileId !== null
      ? getCredentialRow(options.db, input.credentialProfileId)
      : findLatestCredentialForProvider(options.db, "deepseek");

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

  const cached = cachedModelsFor(options.db, credential.id).find((item) => item.id === input.model);
  const builtin = builtinCatalog(credential.provider).find((item) => item.id === input.model);
  const contextWindow = cached?.contextWindow ?? builtin?.contextWindow ?? null;

  if (contextWindow === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the official catalog");
  }

  return {
    provider: credential.provider,
    model: input.model,
    apiKey,
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

  if (credential.provider !== "deepseek" && credential.provider !== "glm") {
    throw new ModelError("MODEL_UNSUPPORTED", "catalog is not available for this provider");
  }

  if (!cachedModelsFor(options.db, credential.id).some((model) => model.id === input.modelId)) {
    throw new ModelError("NOT_FOUND", "model is not in the cached catalog");
  }

  const now = options.now?.() ?? Date.now();
  immediateTransaction(options.db, (tx) => {
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
