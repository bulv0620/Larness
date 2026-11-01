import { and, desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type WebAuthnCredentialRow, webauthnCredentials } from "../schema.js";

export interface CreateWebAuthnCredentialInput {
  deviceId: string;
  credentialId: string;
  publicKey: string;
  createdAt: number;
  counter?: number;
  transportsJson?: string;
  aaguid?: string;
  backupEligible?: boolean;
  backupState?: boolean;
}

export function createWebAuthnCredential(
  db: DbExecutor,
  input: CreateWebAuthnCredentialInput,
): WebAuthnCredentialRow {
  const row: WebAuthnCredentialRow = {
    id: newId("cred"),
    deviceId: input.deviceId,
    credentialId: input.credentialId,
    publicKey: input.publicKey,
    counter: input.counter ?? 0,
    transportsJson: input.transportsJson ?? "[]",
    aaguid: input.aaguid ?? null,
    backupEligible: input.backupEligible ?? false,
    backupState: input.backupState ?? false,
    createdAt: input.createdAt,
    lastUsedAt: null,
    revokedAt: null,
  };

  db.insert(webauthnCredentials).values(row).run();

  return row;
}

export function getCredentialByCredentialId(
  db: DbExecutor,
  credentialId: string,
): WebAuthnCredentialRow | null {
  return (
    db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credentialId))
      .get() ?? null
  );
}

export function listActiveCredentials(db: DbExecutor): WebAuthnCredentialRow[] {
  return db.select().from(webauthnCredentials).where(isNull(webauthnCredentials.revokedAt)).all();
}

export function getActiveCredentialByDevice(
  db: DbExecutor,
  deviceId: string,
): WebAuthnCredentialRow | null {
  return (
    db
      .select()
      .from(webauthnCredentials)
      .where(and(eq(webauthnCredentials.deviceId, deviceId), isNull(webauthnCredentials.revokedAt)))
      .orderBy(desc(webauthnCredentials.createdAt))
      .get() ?? null
  );
}

export function revokeCredentialsByDevice(
  db: DbExecutor,
  deviceId: string,
  now = Date.now(),
): number {
  return db
    .update(webauthnCredentials)
    .set({ revokedAt: now })
    .where(and(eq(webauthnCredentials.deviceId, deviceId), isNull(webauthnCredentials.revokedAt)))
    .run().changes;
}

export function updateCredentialUsage(
  db: DbExecutor,
  id: string,
  input: {
    counter: number;
    lastUsedAt: number;
    backupEligible: boolean;
    backupState: boolean;
  },
): void {
  db.update(webauthnCredentials)
    .set({
      counter: input.counter,
      lastUsedAt: input.lastUsedAt,
      backupEligible: input.backupEligible,
      backupState: input.backupState,
    })
    .where(eq(webauthnCredentials.id, id))
    .run();
}

export function listCredentialsByDevice(db: DbExecutor, deviceId: string): WebAuthnCredentialRow[] {
  return db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.deviceId, deviceId))
    .all();
}

export function updateCredentialCounter(
  db: DbExecutor,
  id: string,
  counter: number,
  lastUsedAt = Date.now(),
): void {
  db.update(webauthnCredentials)
    .set({ counter, lastUsedAt })
    .where(eq(webauthnCredentials.id, id))
    .run();
}

export function revokeCredential(db: DbExecutor, id: string, now = Date.now()): boolean {
  return (
    db
      .update(webauthnCredentials)
      .set({ revokedAt: now })
      .where(and(eq(webauthnCredentials.id, id), isNull(webauthnCredentials.revokedAt)))
      .run().changes > 0
  );
}
