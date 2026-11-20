import type { ErrorCode } from "@larness/shared";
import type { Database, DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type {
  WebSearchConnectionRow,
  WebSearchProviderId,
  WebSearchRegion,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import { DEEPSEEK_BASE_URL } from "./deepseek.js";
import { WebSearchError } from "./errors.js";
import { GLM_SEARCH_REGIONS } from "./glm.js";
import {
  createWebSearchConnectionRow,
  createWebSearchSecretRow,
  deleteWebSearchConnectionRow,
  deleteWebSearchSecretIfUnused,
  getWebSearchConnectionRow,
  getWebSearchSecretRow,
  listWebSearchConnectionRows,
  updateWebSearchConnectionRow,
} from "./repository.js";
import { getWebSearchSettings, setWebSearchSettings } from "./settings.js";
import type { WebSearchConnectionRef } from "./types.js";

export const MASKED_SEARCH_KEY = "••••••";

export class WebSearchConfigError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "WebSearchConfigError";
    this.code = code;
  }
}

export interface WebSearchConnectionDto {
  id: string;
  provider: WebSearchProviderId;
  label: string;
  region: WebSearchRegion | null;
  endpoint: string;
  maskedKey: string;
  createdAt: number;
}

export interface WebSearchConfigOptions {
  db: Database;
  secretStore: SecretStore;
  now?: () => number;
}

export interface CreateWebSearchConnectionInput {
  provider: WebSearchProviderId;
  label: string;
  apiKey: string;
  region?: WebSearchRegion;
  clientSessionId?: string;
}

export interface UpdateWebSearchConnectionInput {
  id: string;
  label?: string;
  apiKey?: string;
  region?: WebSearchRegion;
  clientSessionId?: string;
}

export interface ActiveWebSearchConnection {
  connection: WebSearchConnectionRef;
  apiKey: string;
}

function normalizeLabel(label: string): string {
  const value = label.trim();
  if (value.length === 0 || value.length > 64) {
    throw new WebSearchConfigError("VALIDATION_ERROR", "label must be 1-64 characters");
  }
  return value;
}

function normalizeApiKey(apiKey: string): string {
  if (apiKey.trim().length === 0 || apiKey.length > 8_192) {
    throw new WebSearchConfigError("VALIDATION_ERROR", "apiKey must be 1-8192 characters");
  }
  return apiKey;
}

function normalizeRegion(
  provider: WebSearchProviderId,
  region: WebSearchRegion | undefined,
): WebSearchRegion | null {
  if (provider === "deepseek") {
    if (region !== undefined) {
      throw new WebSearchConfigError("VALIDATION_ERROR", "DeepSeek does not use a region");
    }
    return null;
  }

  return region ?? "cn";
}

function endpointFor(provider: WebSearchProviderId, region: WebSearchRegion | null): string {
  if (provider === "deepseek") return DEEPSEEK_BASE_URL;
  return GLM_SEARCH_REGIONS[region ?? "cn"].baseUrl;
}

export function webSearchConnectionDto(row: WebSearchConnectionRow): WebSearchConnectionDto {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    region: row.region,
    endpoint: row.endpoint,
    maskedKey: MASKED_SEARCH_KEY,
    createdAt: row.createdAt,
  };
}

export function listWebSearchConnections(db: DbExecutor): WebSearchConnectionDto[] {
  return listWebSearchConnectionRows(db).map(webSearchConnectionDto);
}

export function createWebSearchConnection(
  options: WebSearchConfigOptions,
  input: CreateWebSearchConnectionInput,
): WebSearchConnectionDto {
  const now = options.now?.() ?? Date.now();
  const provider = input.provider;
  const region = normalizeRegion(provider, input.region);
  const endpoint = endpointFor(provider, region);
  const label = normalizeLabel(input.label);
  const apiKey = normalizeApiKey(input.apiKey);
  const encrypted = options.secretStore.encrypt(apiKey);

  const row = immediateTransaction(options.db, (tx) => {
    const created = createWebSearchConnectionRow(tx, {
      secretId: newId("sec"),
      encrypted,
      provider,
      label,
      region,
      endpoint,
      now,
    });
    appendAudit(tx, {
      action: "web_search.connection.created",
      clientSessionId: input.clientSessionId,
      resourceType: "web_search_connection",
      resourceId: created.id,
      details: { provider, region, label },
      now,
    });
    return created;
  });

  const settings = getWebSearchSettings(options.db);
  if (settings.activeConnectionId === null) {
    setWebSearchSettings(options.db, { ...settings, activeConnectionId: row.id }, now);
  }

  return webSearchConnectionDto(row);
}

export function updateWebSearchConnection(
  options: WebSearchConfigOptions,
  input: UpdateWebSearchConnectionInput,
): WebSearchConnectionDto {
  const now = options.now?.() ?? Date.now();
  const existing = getWebSearchConnectionRow(options.db, input.id);

  if (existing === null) {
    throw new WebSearchConfigError("NOT_FOUND", "web search connection not found");
  }

  const label = input.label === undefined ? existing.label : normalizeLabel(input.label);
  const region =
    input.region === undefined ? existing.region : normalizeRegion(existing.provider, input.region);
  const endpoint =
    input.region === undefined ? existing.endpoint : endpointFor(existing.provider, region);
  const apiKey = input.apiKey === undefined ? undefined : normalizeApiKey(input.apiKey);
  const encrypted = apiKey === undefined ? null : options.secretStore.encrypt(apiKey);

  const updated = immediateTransaction(options.db, (tx) => {
    const newSecretId = encrypted === null ? null : newId("sec");
    if (newSecretId !== null && encrypted !== null) {
      createWebSearchSecretRow(tx, newSecretId, encrypted, now);
    }
    updateWebSearchConnectionRow(tx, existing.id, {
      label,
      region,
      endpoint,
      ...(newSecretId === null ? {} : { secretRef: newSecretId }),
    });
    appendAudit(tx, {
      action: "web_search.connection.updated",
      clientSessionId: input.clientSessionId,
      resourceType: "web_search_connection",
      resourceId: existing.id,
      details: {
        provider: existing.provider,
        region,
        label,
        keyRotated: newSecretId !== null,
      },
      now,
    });
    return getWebSearchConnectionRow(tx, existing.id) ?? existing;
  });

  if (encrypted !== null) {
    deleteWebSearchSecretIfUnused(options.db, existing.secretRef);
  }

  return webSearchConnectionDto(updated);
}

export function deleteWebSearchConnection(
  options: WebSearchConfigOptions,
  id: string,
  clientSessionId?: string,
): void {
  const now = options.now?.() ?? Date.now();
  const existing = getWebSearchConnectionRow(options.db, id);

  if (existing === null) {
    throw new WebSearchConfigError("NOT_FOUND", "web search connection not found");
  }

  immediateTransaction(options.db, (tx) => {
    deleteWebSearchConnectionRow(tx, id);
    appendAudit(tx, {
      action: "web_search.connection.deleted",
      clientSessionId,
      resourceType: "web_search_connection",
      resourceId: id,
      details: { provider: existing.provider, region: existing.region, label: existing.label },
      now,
    });
    deleteWebSearchSecretIfUnused(tx, existing.secretRef);

    const settings = getWebSearchSettings(tx);
    if (settings.activeConnectionId === id) {
      setWebSearchSettings(tx, { ...settings, activeConnectionId: null }, now);
    }
  });
}

export function activeConnectionRow(db: DbExecutor): WebSearchConnectionRow | null {
  const settings = getWebSearchSettings(db);
  if (settings.activeConnectionId === null) return null;
  return getWebSearchConnectionRow(db, settings.activeConnectionId);
}

export function hasActiveWebSearchConnection(db: DbExecutor): boolean {
  const row = activeConnectionRow(db);
  return row !== null && getWebSearchSecretRow(db, row.secretRef) !== null;
}

/**
 * Resolves the active connection and decrypts its key for one tool call. The
 * plaintext never leaves this return value and must not be cached by callers.
 */
export function resolveActiveWebSearchConnection(
  options: WebSearchConfigOptions,
): ActiveWebSearchConnection | null {
  const row = activeConnectionRow(options.db);

  if (row === null) return null;

  return decryptConnection(options, row);
}

export function resolveWebSearchConnection(
  options: WebSearchConfigOptions,
  id: string,
): ActiveWebSearchConnection {
  const row = getWebSearchConnectionRow(options.db, id);

  if (row === null) {
    throw new WebSearchConfigError("NOT_FOUND", "web search connection not found");
  }

  return decryptConnection(options, row);
}

function decryptConnection(
  options: WebSearchConfigOptions,
  row: WebSearchConnectionRow,
): ActiveWebSearchConnection {
  const secret = getWebSearchSecretRow(options.db, row.secretRef);

  if (secret === null) {
    throw new WebSearchError("WEB_SEARCH_AUTH_FAILED", "search credential is missing");
  }

  let apiKey: string;

  try {
    apiKey = options.secretStore.decrypt(secret);
  } catch {
    throw new WebSearchError("WEB_SEARCH_AUTH_FAILED", "search credential cannot be decrypted");
  }

  return {
    connection: {
      id: row.id,
      provider: row.provider,
      region: row.region,
      endpoint: row.endpoint,
    },
    apiKey,
  };
}
