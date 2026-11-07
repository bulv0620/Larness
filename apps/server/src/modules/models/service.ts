import { GLM_BASE_URL, GLM_ENDPOINTS } from "@larness/agent";
import type { ErrorCode } from "@larness/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import {
  type CredentialProfileRow,
  credentialProfiles,
  type ModelProfileRow,
  type ModelProviderId,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import type { SecretStore } from "../../security/secretStore.js";
import {
  countCredentialsInUse,
  createCredentialRows,
  createModelProfileRow,
  DEFAULT_MODEL_CAPABILITIES,
  DEFAULT_MODEL_PROFILE_ID,
  deleteCredentialRow,
  deleteSecretRow,
  ensureDefaultModelProfiles,
  findLatestCredentialForProvider,
  getCredentialRow,
  getModelProfileRow,
  getSecretRow,
  listCredentialRows,
  listModelProfileRows,
} from "./repository.js";

export const MASKED_SECRET = "••••••";

export class ModelError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ModelError";
    this.code = code;
    this.details = details;
  }
}

export interface ModelCapabilities {
  streaming: boolean;
  toolCalls: boolean;
  vision: boolean;
  reasoning: boolean;
  maxContextTokens: number;
}

export interface CredentialDto {
  id: string;
  provider: ModelProviderId;
  label: string;
  secretRef: string;
  masked: string;
  endpoint: string | null;
  contextWindow: number | null;
  createdAt: number;
}

export interface ModelProfileDto {
  id: string;
  label: string;
  provider: ModelProviderId;
  model: string;
  credentialProfileId: string | null;
  credentialLabel: string | null;
  endpoint: string | null;
  capabilities: ModelCapabilities;
  createdAt: number;
}

export interface ModelServiceOptions {
  db: Database;
  secretStore: SecretStore;
  now?: () => number;
}

export interface CreateCredentialInput {
  provider: ModelProviderId;
  label: string;
  apiKey: string;
  endpoint?: string | null;
  contextWindow?: number | null;
  clientSessionId?: string;
}

export interface CreateModelProfileInput {
  label: string;
  provider: ModelProviderId;
  model: string;
  credentialProfileId?: string;
  endpoint?: string;
  clientSessionId?: string;
}

function parseCapabilities(json: string): ModelCapabilities {
  try {
    const parsed = JSON.parse(json) as Partial<ModelCapabilities>;
    return {
      streaming: parsed.streaming ?? true,
      toolCalls: parsed.toolCalls ?? true,
      vision: parsed.vision ?? false,
      reasoning: parsed.reasoning ?? false,
      maxContextTokens: parsed.maxContextTokens ?? 128_000,
    };
  } catch {
    return { ...DEFAULT_MODEL_CAPABILITIES };
  }
}

function credentialDto(row: CredentialProfileRow): CredentialDto {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    secretRef: row.secretRef,
    masked: MASKED_SECRET,
    endpoint: row.endpoint,
    contextWindow: row.contextWindow,
    createdAt: row.createdAt,
  };
}

function modelDto(row: ModelProfileRow, credential: CredentialProfileRow | null): ModelProfileDto {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    model: row.model,
    credentialProfileId: row.credentialProfileId,
    credentialLabel: credential?.label ?? null,
    endpoint: row.endpoint,
    capabilities: parseCapabilities(row.capabilitiesJson),
    createdAt: row.createdAt,
  };
}

function normalizeLabel(label: string, field = "label"): string {
  const trimmed = label.trim();

  if (trimmed.length === 0 || trimmed.length > 64) {
    throw new ModelError("VALIDATION_ERROR", `${field} must be 1-64 characters`);
  }

  return trimmed;
}

export function listCredentialDtos(options: ModelServiceOptions): CredentialDto[] {
  return listCredentialRows(options.db).map(credentialDto);
}

export function createCredential(
  options: ModelServiceOptions,
  input: CreateCredentialInput,
): CredentialDto {
  if (
    input.provider !== "deepseek" &&
    input.provider !== "glm" &&
    input.provider !== "openai-compatible"
  ) {
    throw new ModelError("VALIDATION_ERROR", "unsupported credential provider");
  }

  const label = normalizeLabel(input.label);
  const endpoint = normalizeCredentialEndpoint(input.provider, input.endpoint);
  const contextWindow = normalizeCredentialContextWindow(input.provider, input.contextWindow);

  if (input.apiKey.length === 0 || input.apiKey.length > 8_192) {
    throw new ModelError("VALIDATION_ERROR", "apiKey must be 1-8192 characters");
  }

  const now = options.now?.() ?? Date.now();
  const encrypted = options.secretStore.encrypt(input.apiKey);

  const row = immediateTransaction(options.db, (tx) => {
    const created = createCredentialRows(tx, {
      secretId: newId("sec"),
      encrypted,
      provider: input.provider,
      label,
      endpoint,
      contextWindow,
      now,
    });
    appendAudit(tx, {
      action: "credential.created",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "credential",
      resourceId: created.credential.id,
      details: { provider: input.provider, label, endpoint, secretRef: created.secret.id },
      now,
    });
    return created.credential;
  });

  return credentialDto(row);
}

function normalizeCredentialEndpoint(
  provider: ModelProviderId,
  endpoint: string | null | undefined,
): string | null {
  if (provider === "glm") {
    if (endpoint === undefined || endpoint === null || endpoint === "") {
      return GLM_BASE_URL;
    }

    if (
      !Object.values(GLM_ENDPOINTS).includes(
        endpoint as (typeof GLM_ENDPOINTS)[keyof typeof GLM_ENDPOINTS],
      )
    ) {
      throw new ModelError("VALIDATION_ERROR", "unsupported GLM endpoint");
    }

    return endpoint;
  }

  if (provider === "openai-compatible") {
    if (endpoint === undefined || endpoint === null || endpoint.trim() === "") {
      throw new ModelError("VALIDATION_ERROR", "compatible endpoint is required");
    }

    return endpoint.trim().replace(/\/$/, "");
  }

  if (endpoint !== undefined && endpoint !== null && endpoint !== "") {
    throw new ModelError(
      "VALIDATION_ERROR",
      "endpoint is only supported for GLM or compatible credentials",
    );
  }

  return null;
}

function normalizeCredentialContextWindow(
  provider: ModelProviderId,
  contextWindow: number | null | undefined,
): number | null {
  if (provider !== "openai-compatible") {
    return null;
  }

  const value = contextWindow ?? 128_000;

  if (!Number.isInteger(value) || value < 1_024 || value > 10_000_000) {
    throw new ModelError("VALIDATION_ERROR", "contextWindow must be between 1024 and 10000000");
  }

  return value;
}

export function updateCredentialSettings(
  options: ModelServiceOptions,
  input: {
    id: string;
    endpoint?: string | null;
    contextWindow?: number | null;
    clientSessionId?: string;
  },
): CredentialDto {
  const now = options.now?.() ?? Date.now();
  const row = immediateTransaction(options.db, (tx) => {
    const credential = getCredentialRow(tx, input.id);

    if (credential === null) {
      throw new ModelError("NOT_FOUND", "credential not found");
    }

    if (credential.provider !== "glm" && credential.provider !== "openai-compatible") {
      throw new ModelError(
        "VALIDATION_ERROR",
        "endpoint is only supported for GLM or compatible credentials",
      );
    }

    const endpoint =
      input.endpoint === undefined
        ? credential.endpoint
        : normalizeCredentialEndpoint(credential.provider, input.endpoint);
    const contextWindow =
      input.contextWindow === undefined
        ? credential.contextWindow
        : normalizeCredentialContextWindow(credential.provider, input.contextWindow);
    const updated = { ...credential, endpoint, contextWindow };
    tx.update(credentialProfiles)
      .set({ endpoint, contextWindow })
      .where(eq(credentialProfiles.id, credential.id))
      .run();
    appendAudit(tx, {
      action: "credential.endpoint.changed",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "credential",
      resourceId: credential.id,
      details: { endpoint, contextWindow },
      now,
    });
    return updated;
  });

  return credentialDto(row);
}

export function updateCredentialEndpoint(
  options: ModelServiceOptions,
  input: { id: string; endpoint: string | null; clientSessionId?: string },
): CredentialDto {
  return updateCredentialSettings(options, input);
}

export function deleteCredential(
  options: ModelServiceOptions,
  input: { id: string; clientSessionId?: string },
): void {
  const now = options.now?.() ?? Date.now();

  immediateTransaction(options.db, (tx) => {
    const credential = getCredentialRow(tx, input.id);

    if (credential === null) {
      throw new ModelError("NOT_FOUND", "credential not found");
    }

    if (countCredentialsInUse(tx, credential.id) > 0) {
      throw new ModelError("CONFLICT", "credential is used by a model profile");
    }

    deleteCredentialRow(tx, credential);
    deleteSecretRow(tx, credential.secretRef);
    appendAudit(tx, {
      action: "credential.deleted",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "credential",
      resourceId: credential.id,
      details: { provider: credential.provider, label: credential.label },
      now,
    });
  });
}

export function listModelDtos(options: ModelServiceOptions): ModelProfileDto[] {
  ensureDefaultModelProfiles(options.db);

  return listModelProfileRows(options.db).map((row) =>
    modelDto(
      row,
      row.credentialProfileId === null
        ? null
        : getCredentialRow(options.db, row.credentialProfileId),
    ),
  );
}

export function createModelProfile(
  options: ModelServiceOptions,
  input: CreateModelProfileInput,
): ModelProfileDto {
  if (
    input.provider !== "deepseek" &&
    input.provider !== "glm" &&
    input.provider !== "openai-compatible"
  ) {
    throw new ModelError("VALIDATION_ERROR", "unsupported model provider");
  }

  const label = normalizeLabel(input.label);
  const model = normalizeLabel(input.model, "model");
  const now = options.now?.() ?? Date.now();

  const row = immediateTransaction(options.db, (tx) => {
    if (
      input.credentialProfileId !== undefined &&
      getCredentialRow(tx, input.credentialProfileId) === null
    ) {
      throw new ModelError("NOT_FOUND", "credential not found");
    }

    const created = createModelProfileRow(tx, {
      label,
      provider: input.provider,
      model,
      credentialProfileId: input.credentialProfileId ?? null,
      endpoint: input.endpoint?.trim() || null,
      capabilitiesJson: JSON.stringify(DEFAULT_MODEL_CAPABILITIES),
      now,
    });
    appendAudit(tx, {
      action: "model.created",
      decision: "allow",
      clientSessionId: input.clientSessionId,
      resourceType: "model",
      resourceId: created.id,
      details: { provider: created.provider, model: created.model },
      now,
    });
    return created;
  });

  return modelDto(
    row,
    row.credentialProfileId === null ? null : getCredentialRow(options.db, row.credentialProfileId),
  );
}

export interface ResolvedModel {
  profile: ModelProfileDto;
  apiKey: string | null;
}

export function resolveModel(
  options: ModelServiceOptions,
  profileId: string | null,
): ResolvedModel | null {
  ensureDefaultModelProfiles(options.db);

  const row = getModelProfileRow(options.db, profileId ?? DEFAULT_MODEL_PROFILE_ID);

  if (row === null) {
    return null;
  }

  const credential =
    row.credentialProfileId === null
      ? findLatestCredentialForProvider(options.db, row.provider)
      : getCredentialRow(options.db, row.credentialProfileId);

  if (credential === null) {
    return { profile: modelDto(row, null), apiKey: null };
  }

  const secret = getSecretRow(options.db, credential.secretRef);

  if (secret === null) {
    throw new ModelError("PROVIDER_AUTH_FAILED", "credential secret is missing");
  }

  try {
    return {
      profile: modelDto(row, credential),
      apiKey: options.secretStore.decrypt(secret),
    };
  } catch {
    throw new ModelError("PROVIDER_AUTH_FAILED", "credential cannot be decrypted");
  }
}
