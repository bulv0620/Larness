import { and, desc, eq, notExists } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  credentialProfiles,
  type SecretRow,
  secrets,
  turns,
  type WebSearchConnectionRow,
  type WebSearchProviderId,
  type WebSearchRegion,
  webSearchConnections,
} from "../../db/schema.js";

export function listWebSearchConnectionRows(db: DbExecutor): WebSearchConnectionRow[] {
  return db
    .select()
    .from(webSearchConnections)
    .orderBy(desc(webSearchConnections.createdAt), desc(webSearchConnections.id))
    .all();
}

export function getWebSearchConnectionRow(
  db: DbExecutor,
  id: string,
): WebSearchConnectionRow | null {
  return (
    db.select().from(webSearchConnections).where(eq(webSearchConnections.id, id)).get() ?? null
  );
}

export function createWebSearchConnectionRow(
  db: DbExecutor,
  input: {
    secretId: string;
    encrypted: Pick<SecretRow, "ciphertext" | "nonce" | "tag">;
    provider: WebSearchProviderId;
    label: string;
    region: WebSearchRegion | null;
    endpoint: string;
    now: number;
  },
): WebSearchConnectionRow {
  const secret: SecretRow = {
    id: input.secretId,
    ...input.encrypted,
    createdAt: input.now,
  };
  db.insert(secrets).values(secret).run();

  const row: WebSearchConnectionRow = {
    id: newId("wsc"),
    provider: input.provider,
    label: input.label,
    region: input.region,
    endpoint: input.endpoint,
    secretRef: secret.id,
    createdAt: input.now,
  };
  db.insert(webSearchConnections).values(row).run();
  return row;
}

export function updateWebSearchConnectionRow(
  db: DbExecutor,
  id: string,
  input: {
    label?: string;
    region?: WebSearchRegion | null;
    endpoint?: string;
    secretRef?: string;
  },
): void {
  db.update(webSearchConnections)
    .set({
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.region === undefined ? {} : { region: input.region }),
      ...(input.endpoint === undefined ? {} : { endpoint: input.endpoint }),
      ...(input.secretRef === undefined ? {} : { secretRef: input.secretRef }),
    })
    .where(eq(webSearchConnections.id, id))
    .run();
}

export function deleteWebSearchConnectionRow(db: DbExecutor, id: string): void {
  db.delete(webSearchConnections).where(eq(webSearchConnections.id, id)).run();
}

export function getWebSearchSecretRow(db: DbExecutor, id: string): SecretRow | null {
  return db.select().from(secrets).where(eq(secrets.id, id)).get() ?? null;
}

export function createWebSearchSecretRow(
  db: DbExecutor,
  id: string,
  encrypted: Pick<SecretRow, "ciphertext" | "nonce" | "tag">,
  now: number,
): SecretRow {
  const secret: SecretRow = { id, ...encrypted, createdAt: now };
  db.insert(secrets).values(secret).run();
  return secret;
}

/**
 * Deleting a connection must not delete a secret still referenced by a model
 * credential, a Turn connection snapshot, or another search connection.
 */
export function deleteWebSearchSecretIfUnused(db: DbExecutor, id: string): void {
  db.delete(secrets)
    .where(
      and(
        eq(secrets.id, id),
        notExists(
          db
            .select({ id: credentialProfiles.id })
            .from(credentialProfiles)
            .where(eq(credentialProfiles.secretRef, id)),
        ),
        notExists(db.select({ id: turns.id }).from(turns).where(eq(turns.connectionSecretRef, id))),
        notExists(
          db
            .select({ id: webSearchConnections.id })
            .from(webSearchConnections)
            .where(eq(webSearchConnections.secretRef, id)),
        ),
      ),
    )
    .run();
}
