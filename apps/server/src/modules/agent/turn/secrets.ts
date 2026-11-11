import type { EncryptedSecretRef } from "@larness/agent";

/**
 * Read the secret rows once per Turn (D8). Decryption still happens per call,
 * so no plaintext outlives a single tool invocation.
 */
export function createSecretLoader(load: () => EncryptedSecretRef[]): () => EncryptedSecretRef[] {
  let cached: EncryptedSecretRef[] | null = null;

  return () => (cached ??= load());
}
