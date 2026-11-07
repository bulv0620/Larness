import { desc, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  type CredentialProfileRow,
  credentialProfiles,
  type ModelProfileRow,
  type ModelProviderId,
  modelCatalogCache,
  modelProfiles,
  type SecretRow,
  secrets,
} from "../../db/schema.js";

export const DEFAULT_MODEL_PROFILE_ID = "deepseek-default";

export const DEFAULT_MODEL_CAPABILITIES = {
  streaming: true,
  toolCalls: true,
  vision: false,
  reasoning: false,
  maxContextTokens: 128_000,
} as const;

export function ensureDefaultModelProfiles(db: DbExecutor, now = Date.now()): void {
  if (getModelProfileRow(db, DEFAULT_MODEL_PROFILE_ID) !== null) {
    return;
  }

  db.insert(modelProfiles)
    .values({
      id: DEFAULT_MODEL_PROFILE_ID,
      label: "DeepSeek Chat",
      provider: "deepseek",
      model: "deepseek-chat",
      credentialProfileId: null,
      endpoint: null,
      capabilitiesJson: JSON.stringify(DEFAULT_MODEL_CAPABILITIES),
      createdAt: now,
    })
    .run();
}

export function listModelProfileRows(db: DbExecutor): ModelProfileRow[] {
  return db
    .select()
    .from(modelProfiles)
    .orderBy(desc(modelProfiles.createdAt), desc(modelProfiles.id))
    .all();
}

export function getModelProfileRow(db: DbExecutor, id: string): ModelProfileRow | null {
  return db.select().from(modelProfiles).where(eq(modelProfiles.id, id)).get() ?? null;
}

export function createModelProfileRow(
  db: DbExecutor,
  input: {
    label: string;
    provider: ModelProviderId;
    model: string;
    credentialProfileId: string | null;
    endpoint: string | null;
    capabilitiesJson: string;
    now: number;
  },
): ModelProfileRow {
  const row: ModelProfileRow = {
    id: newId("mdl"),
    label: input.label,
    provider: input.provider,
    model: input.model,
    credentialProfileId: input.credentialProfileId,
    endpoint: input.endpoint,
    capabilitiesJson: input.capabilitiesJson,
    createdAt: input.now,
  };

  db.insert(modelProfiles).values(row).run();
  return row;
}

export function listCredentialRows(db: DbExecutor): CredentialProfileRow[] {
  return db
    .select()
    .from(credentialProfiles)
    .orderBy(desc(credentialProfiles.createdAt), desc(credentialProfiles.id))
    .all();
}

export function getCredentialRow(db: DbExecutor, id: string): CredentialProfileRow | null {
  return db.select().from(credentialProfiles).where(eq(credentialProfiles.id, id)).get() ?? null;
}

export function findLatestCredentialForProvider(
  db: DbExecutor,
  provider: ModelProviderId,
): CredentialProfileRow | null {
  return (
    db
      .select()
      .from(credentialProfiles)
      .where(eq(credentialProfiles.provider, provider))
      .orderBy(desc(credentialProfiles.createdAt), sql`rowid desc`)
      .limit(1)
      .get() ?? null
  );
}

export function createCredentialRows(
  db: DbExecutor,
  input: {
    secretId: string;
    encrypted: { ciphertext: string; nonce: string; tag: string };
    provider: ModelProviderId;
    label: string;
    now: number;
  },
): { secret: SecretRow; credential: CredentialProfileRow } {
  const secret: SecretRow = {
    id: input.secretId,
    ciphertext: input.encrypted.ciphertext,
    nonce: input.encrypted.nonce,
    tag: input.encrypted.tag,
    createdAt: input.now,
  };
  db.insert(secrets).values(secret).run();

  const credential: CredentialProfileRow = {
    id: newId("cred"),
    provider: input.provider,
    label: input.label,
    secretRef: secret.id,
    createdAt: input.now,
  };
  db.insert(credentialProfiles).values(credential).run();
  return { secret, credential };
}

export function getSecretRow(db: DbExecutor, id: string): SecretRow | null {
  return db.select().from(secrets).where(eq(secrets.id, id)).get() ?? null;
}

export function countCredentialsInUse(db: DbExecutor, credentialId: string): number {
  return db
    .select({ id: modelProfiles.id })
    .from(modelProfiles)
    .where(eq(modelProfiles.credentialProfileId, credentialId))
    .all().length;
}

export function deleteCredentialRow(db: DbExecutor, credential: CredentialProfileRow): void {
  db.delete(credentialProfiles).where(eq(credentialProfiles.id, credential.id)).run();
}

export function deleteSecretRow(db: DbExecutor, id: string): void {
  db.delete(secrets).where(eq(secrets.id, id)).run();
}

export function listEncryptedSecrets(db: DbExecutor): SecretRow[] {
  return db.select().from(secrets).all();
}

export interface ModelCatalogCacheRow {
  credentialProfileId: string;
  provider: ModelProviderId;
  endpoint: string;
  modelsJson: string;
  syncedAt: number | null;
  lastAttemptAt: number | null;
  lastErrorCode: string | null;
}

export function getModelCatalogCache(
  db: DbExecutor,
  credentialProfileId: string,
): ModelCatalogCacheRow | null {
  const row =
    db
      .select()
      .from(modelCatalogCache)
      .where(eq(modelCatalogCache.credentialProfileId, credentialProfileId))
      .get() ?? null;

  if (row === null) {
    return null;
  }

  return {
    credentialProfileId: row.credentialProfileId,
    provider: row.provider,
    endpoint: row.endpoint,
    modelsJson: row.modelsJson,
    syncedAt: row.syncedAt,
    lastAttemptAt: row.lastAttemptAt,
    lastErrorCode: row.lastErrorCode,
  };
}

export function saveModelCatalog(
  db: DbExecutor,
  input: {
    credentialProfileId: string;
    provider: ModelProviderId;
    endpoint: string;
    modelsJson: string;
    now: number;
  },
): void {
  db.insert(modelCatalogCache)
    .values({
      credentialProfileId: input.credentialProfileId,
      provider: input.provider,
      endpoint: input.endpoint,
      modelsJson: input.modelsJson,
      syncedAt: input.now,
      lastAttemptAt: input.now,
      lastErrorCode: null,
    })
    .onConflictDoUpdate({
      target: modelCatalogCache.credentialProfileId,
      set: {
        provider: input.provider,
        endpoint: input.endpoint,
        modelsJson: input.modelsJson,
        syncedAt: input.now,
        lastAttemptAt: input.now,
        lastErrorCode: null,
      },
    })
    .run();
}

export function recordModelCatalogFailure(
  db: DbExecutor,
  input: {
    credentialProfileId: string;
    provider: ModelProviderId;
    endpoint: string;
    errorCode: string;
    now: number;
  },
): void {
  db.insert(modelCatalogCache)
    .values({
      credentialProfileId: input.credentialProfileId,
      provider: input.provider,
      endpoint: input.endpoint,
      modelsJson: "[]",
      syncedAt: null,
      lastAttemptAt: input.now,
      lastErrorCode: input.errorCode,
    })
    .onConflictDoUpdate({
      target: modelCatalogCache.credentialProfileId,
      set: {
        lastAttemptAt: input.now,
        lastErrorCode: input.errorCode,
      },
    })
    .run();
}
