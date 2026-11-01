import { chmod, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { masterKeyPath, SecretStore, SecretStoreError } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

describe("SecretStore", () => {
  it("creates a 0600 master key and round-trips AES-256-GCM secrets", async () => {
    await withTempDir(async (dir) => {
      const store = await SecretStore.open(dir);
      const keyFile = masterKeyPath(dir);
      const key = await readFile(keyFile);

      expect(key).toHaveLength(32);

      if (process.platform !== "win32") {
        expect((await stat(path.dirname(keyFile))).mode & 0o777).toBe(0o700);
        expect((await stat(keyFile)).mode & 0o777).toBe(0o600);
      }

      const encrypted = store.encrypt("sk-test-secret");
      expect(encrypted.ciphertext).not.toContain("sk-test-secret");
      expect(store.decrypt(encrypted)).toBe("sk-test-secret");

      const reopened = await SecretStore.open(dir);
      expect(reopened.decrypt(encrypted)).toBe("sk-test-secret");
    });
  });

  it("rejects tampered ciphertext, nonce and tag without leaking details", async () => {
    await withTempDir(async (dir) => {
      const store = await SecretStore.open(dir);
      const encrypted = store.encrypt("secret");
      const tampered = Buffer.from(encrypted.ciphertext, "base64");
      tampered[0] = (tampered[0] ?? 0) ^ 0xff;

      expect(() =>
        store.decrypt({ ...encrypted, ciphertext: tampered.toString("base64") }),
      ).toThrowError(SecretStoreError);
      expect(() => store.decrypt({ ...encrypted, nonce: "AAAA" })).toThrowError(SecretStoreError);
      expect(() => store.decrypt({ ...encrypted, tag: "AAAA" })).toThrowError(SecretStoreError);
    });
  });

  it("fails closed when another master key is used", async () => {
    await withTempDir(async (first) => {
      await withTempDir(async (second) => {
        const store = await SecretStore.open(first);
        const other = await SecretStore.open(second);
        const encrypted = store.encrypt("secret");

        expect(() => other.decrypt(encrypted)).toThrowError(SecretStoreError);
      });
    });
  });

  it("hardens a master key with overly open permissions", async () => {
    await withTempDir(async (dir) => {
      await SecretStore.open(dir);

      if (process.platform === "win32") {
        return;
      }

      await chmod(masterKeyPath(dir), 0o644);
      await SecretStore.open(dir);
      expect((await stat(masterKeyPath(dir))).mode & 0o777).toBe(0o600);
    });
  });
});
