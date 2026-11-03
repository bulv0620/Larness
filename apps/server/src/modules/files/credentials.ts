import { FileManagerError } from "@larness/resources";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { listEncryptedSecrets } from "../models/repository.js";

export function knownCredentialGuard(db: Database, store?: SecretStore) {
  return (value: string) => {
    const secrets = listEncryptedSecrets(db);
    if (!store) {
      if (secrets.length)
        throw new FileManagerError("INTERNAL", "Credential protection is unavailable");
      return;
    }
    for (const secret of secrets) {
      const plaintext = store.decrypt(secret);
      if (plaintext.length && value.includes(plaintext))
        throw new FileManagerError("FILE_NOT_EDITABLE", "File contains protected credentials");
    }
  };
}
