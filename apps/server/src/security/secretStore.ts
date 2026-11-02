import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedSecret {
  ciphertext: string;
  nonce: string;
  tag: string;
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

export function masterKeyPath(dataDir: string): string {
  return path.join(dataDir, "secrets", "master.key");
}

async function verifyPermissions(file: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  const info = await stat(file);

  if ((info.mode & 0o077) !== 0) {
    await chmod(file, 0o600);
    const updated = await stat(file);

    if ((updated.mode & 0o077) !== 0) {
      throw new SecretStoreError("master key permissions must be 0600");
    }
  }
}

async function createKey(file: string): Promise<Buffer> {
  const key = randomBytes(KEY_BYTES);
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, key, { mode: 0o600 });
  await chmod(temporary, 0o600).catch(() => undefined);
  await rename(temporary, file);
  await verifyPermissions(file);
  return key;
}

async function loadKey(file: string): Promise<Buffer> {
  const key = await readFile(file);

  if (key.length !== KEY_BYTES) {
    throw new SecretStoreError("master key has an invalid length");
  }

  await verifyPermissions(file);
  return key;
}

export class SecretStore {
  readonly #key: Buffer;

  private constructor(key: Buffer) {
    this.#key = key;
  }

  static async open(
    dataDir: string,
    encryptedSecrets: readonly EncryptedSecret[] = [],
  ): Promise<SecretStore> {
    const directory = path.join(dataDir, "secrets");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700).catch(() => undefined);

    const file = masterKeyPath(dataDir);
    let key: Buffer;

    try {
      key = await loadKey(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }

      if (encryptedSecrets.length > 0) {
        throw new SecretStoreError(
          "master.key is missing; restore the original secrets/master.key before restarting",
        );
      }
      key = await createKey(file);
    }

    const store = new SecretStore(key);
    try {
      for (const secret of encryptedSecrets) store.decrypt(secret);
    } catch {
      throw new SecretStoreError(
        "cannot validate encrypted credentials; restore the original master.key and database backup",
      );
    }
    return store;
  }

  encrypt(plaintext: string): EncryptedSecret {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.#key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      tag: tag.toString("base64"),
    };
  }

  decrypt(secret: EncryptedSecret): string {
    try {
      const nonce = Buffer.from(secret.nonce, "base64");
      const tag = Buffer.from(secret.tag, "base64");

      if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
        throw new Error("invalid secret format");
      }

      const decipher = createDecipheriv(ALGORITHM, this.#key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(Buffer.from(secret.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new SecretStoreError("cannot decrypt secret");
    }
  }
}
