import type { ErrorCode } from "@larness/shared";
import { z } from "zod";
import type { Database, DbExecutor } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import {
  findLatestCredentialForProvider,
  getModelCatalogCache,
  getSecretRow,
  recordModelCatalogFailure,
  saveModelCatalog,
} from "./repository.js";
import { ModelError } from "./service.js";

export const DEEPSEEK_CATALOG_URL = "https://api.deepseek.com/models";
export const DEFAULT_CATALOG_TIMEOUT_MS = 10_000;

export type ThinkingEffort = "low" | "high" | "max";

export interface CatalogThinkingLevel {
  id: string;
  label: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  contextWindow: number | null;
  thinking: { supported: boolean; levels: CatalogThinkingLevel[] };
  default: boolean;
}

export interface CatalogDto {
  provider: "deepseek";
  credentialProfileId: string;
  syncedAt: number | null;
  stale: boolean;
  lastRefreshError: string | null;
  models: CatalogModel[];
}

export interface CatalogSelection {
  model: string;
  thinking: string;
  contextWindow: number | null;
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

function mergeCatalog(payload: z.infer<typeof upstreamSchema>): CatalogModel[] {
  const models = payload.data.map((entry) => {
    const builtin = DEEPSEEK_BUILTIN_CATALOG.find((item) => item.id === entry.id);
    const supported = entry.thinking?.supported ?? builtin?.thinking.supported ?? false;
    const levels = supported ? THINKING_LEVELS.map((level) => ({ ...level })) : [];

    return {
      id: entry.id,
      label: entry.name ?? builtin?.label ?? entry.id,
      contextWindow: entry.context_window ?? entry.contextWindow ?? builtin?.contextWindow ?? null,
      thinking: { supported, levels },
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
          thinking: z.object({ supported: z.boolean(), levels: z.array(levelSchema) }),
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
            ? { supported: true, levels: THINKING_LEVELS.map((level) => ({ ...level })) }
            : { supported: false, levels: [] },
        },
      ];
    });
  } catch {
    return [];
  }
}

function latestCredential(db: DbExecutor) {
  return findLatestCredentialForProvider(db, "deepseek");
}

function requireCredential(db: DbExecutor) {
  const credential = latestCredential(db);

  if (credential === null) {
    throw new ModelError("MODEL_CREDENTIAL_MISSING", "configure a DeepSeek credential first");
  }

  return credential;
}

function catalogDto(
  credentialProfileId: string,
  row: ReturnType<typeof getModelCatalogCache>,
): CatalogDto {
  if (row === null) {
    return {
      provider: "deepseek",
      credentialProfileId,
      syncedAt: null,
      stale: true,
      lastRefreshError: null,
      models: [],
    };
  }

  return {
    provider: "deepseek",
    credentialProfileId,
    syncedAt: row.syncedAt,
    stale: row.syncedAt === null || row.lastErrorCode !== null,
    lastRefreshError: row.lastErrorCode,
    models: parseModels(row.modelsJson),
  };
}

export function getModelCatalog(options: CatalogOptions): CatalogDto {
  const credential = requireCredential(options.db);
  return catalogDto(credential.id, getModelCatalogCache(options.db, credential.id));
}

function cachedModelsFor(db: DbExecutor, credentialId: string): CatalogModel[] {
  const row = getModelCatalogCache(db, credentialId);
  return row === null ? [] : parseModels(row.modelsJson);
}

export async function refreshModelCatalog(
  options: CatalogOptions,
  input: { clientSessionId?: string } = {},
): Promise<CatalogDto> {
  const credential = requireCredential(options.db);
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

  const now = options.now?.() ?? Date.now();
  const fetcher =
    options.fetcher ??
    createDeepSeekCatalogFetcher(options.timeoutMs ?? DEFAULT_CATALOG_TIMEOUT_MS);
  const controller = new AbortController();

  let payload: unknown;

  try {
    payload = await fetcher(apiKey, controller.signal);
  } catch (error) {
    const code =
      error instanceof CatalogHttpError ? mapErrorCode(error.status) : "PROVIDER_UNAVAILABLE";
    recordFailure(options, credential.id, code, now);
    throw new ModelError(code, "official model catalog is unavailable");
  }

  const parsed = upstreamSchema.safeParse(payload);

  if (!parsed.success) {
    recordFailure(options, credential.id, "MODEL_CATALOG_INVALID", now);
    throw new ModelError("MODEL_CATALOG_INVALID", "official model catalog payload is invalid");
  }

  const models = mergeCatalog(parsed.data);

  if (models.length === 0) {
    recordFailure(options, credential.id, "MODEL_CATALOG_INVALID", now);
    throw new ModelError("MODEL_CATALOG_INVALID", "official model catalog is empty");
  }

  immediateTransaction(options.db, (tx) => {
    saveModelCatalog(tx, {
      credentialProfileId: credential.id,
      provider: "deepseek",
      endpoint: DEEPSEEK_CATALOG_URL,
      modelsJson: JSON.stringify(models),
      now,
    });
    appendAudit(tx, {
      action: "model.catalog.refreshed",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "model_catalog",
      resourceId: credential.id,
      details: { provider: "deepseek", modelCount: models.length },
      now,
    });
  });

  return catalogDto(credential.id, getModelCatalogCache(options.db, credential.id));
}

function recordFailure(
  options: CatalogOptions,
  credentialProfileId: string,
  errorCode: string,
  now: number,
): void {
  immediateTransaction(options.db, (tx) => {
    recordModelCatalogFailure(tx, {
      credentialProfileId,
      provider: "deepseek",
      endpoint: DEEPSEEK_CATALOG_URL,
      errorCode,
      now,
    });
  });
}

function normalizeThinking(model: CatalogModel, thinking: string | null | undefined): string {
  if (thinking === undefined || thinking === null || thinking.length === 0) {
    return "medium";
  }

  if (thinking === "off") {
    return thinking;
  }

  // Legacy sessions stored "default"; the ladder now has explicit low / medium / high.
  if (thinking === "default") {
    return "medium";
  }

  if (!model.thinking.supported) {
    throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
  }

  if (!THINKING_LEVELS.some((level) => level.id === thinking)) {
    throw new ModelError("MODEL_UNSUPPORTED", "thinking level is not supported by this model");
  }

  return thinking;
}

export function resolveCatalogSelection(
  db: DbExecutor,
  input: { model: string; thinking?: string | null },
): CatalogSelection {
  const credential = requireCredential(db);
  const models = cachedModelsFor(db, credential.id);
  const model = models.find((item) => item.id === input.model);

  if (model === undefined || model.contextWindow === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the official catalog");
  }

  return {
    model: model.id,
    thinking: normalizeThinking(model, input.thinking),
    contextWindow: model.contextWindow,
  };
}

export interface ResolvedCatalogProvider {
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

  // "default" is a legacy stored value; treat it as the middle tier.
  return { enabled: true, effort: PROVIDER_EFFORT.medium };
}

export function resolveCatalogProvider(
  options: CatalogOptions,
  input: { model: string; thinking: string | null },
): ResolvedCatalogProvider {
  const credential = requireCredential(options.db);
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
  const builtin = DEEPSEEK_BUILTIN_CATALOG.find((item) => item.id === input.model);
  const contextWindow = cached?.contextWindow ?? builtin?.contextWindow ?? null;

  if (contextWindow === null) {
    throw new ModelError("MODEL_UNSUPPORTED", "model is not available in the official catalog");
  }

  return {
    model: input.model,
    apiKey,
    contextWindow,
    thinking: mapThinkingSetting(input.thinking),
  };
}
