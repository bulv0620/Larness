import type { EncryptedSecretRef } from "@larness/agent";
import type { SecretStore } from "../../security/secretStore.js";

export type SecretVerdict = "ok" | "blocked" | "unavailable";

/**
 * Credentials must not appear in tool arguments. Per D8 the caller supplies the
 * secret rows read once per Turn; this check still decrypts on every call and
 * never caches plaintext.
 */
export function secretVerdict(
  values: string[],
  secrets: EncryptedSecretRef[],
  secretStore: SecretStore | undefined,
): SecretVerdict {
  if (secrets.length === 0) {
    return "ok";
  }

  if (secretStore === undefined) {
    return "unavailable";
  }

  for (const secret of secrets) {
    let plaintext: string;

    try {
      plaintext = secretStore.decrypt(secret);
    } catch {
      // A credential that cannot be decrypted must not silently disable the
      // guard; fail closed instead of pretending the arguments are clean.
      return "unavailable";
    }

    if (plaintext.length > 0 && values.some((value) => value.includes(plaintext))) {
      return "blocked";
    }
  }

  return "ok";
}
