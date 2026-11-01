import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CSRF_KEY_BYTES = 32;

export function csrfKeyPath(dataDir: string): string {
  return path.join(dataDir, "secrets", "csrf.key");
}

export async function loadOrCreateCsrfKey(dataDir: string): Promise<Buffer> {
  const file = csrfKeyPath(dataDir);

  try {
    const key = await readFile(file);

    if (key.length !== CSRF_KEY_BYTES) {
      throw new Error("csrf.key must contain exactly 32 bytes");
    }

    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const key = randomBytes(CSRF_KEY_BYTES);
  await writeFile(file, key, { mode: 0o600 });

  if (process.platform !== "win32") {
    await chmod(file, 0o600);
  }

  return key;
}

export function csrfTokenFor(sessionId: string, key: Buffer): string {
  return createHmac("sha256", key).update(sessionId, "utf8").digest("base64url");
}

export function verifyCsrfToken(token: string, sessionId: string, key: Buffer): boolean {
  const expected = Buffer.from(csrfTokenFor(sessionId, key), "utf8");
  const actual = Buffer.from(token, "utf8");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
