import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { ensureDefaultModelProfiles } from "../../src/modules/models/repository.js";
import {
  createCredential,
  createModelProfile,
  deleteCredential,
  listCredentialDtos,
  listModelDtos,
  ModelError,
  resolveModel,
} from "../../src/modules/models/service.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

async function fixture(dir: string): Promise<{
  opened: OpenedDatabase;
  store: SecretStore;
  options: { db: OpenedDatabase["db"]; secretStore: SecretStore };
}> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  ensureDefaultModelProfiles(opened.db, 1_000);
  const store = await SecretStore.open(dir);
  return {
    opened,
    store,
    options: { db: opened.db, secretStore: store },
  };
}

describe("model service", () => {
  it("seeds deepseek-chat and never returns secret material", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        const models = listModelDtos(options);
        expect(models).toHaveLength(1);
        expect(models[0]).toMatchObject({
          id: "deepseek-default",
          label: "DeepSeek Chat",
          provider: "deepseek",
          model: "deepseek-chat",
          credentialProfileId: null,
          capabilities: { streaming: true, toolCalls: true, maxContextTokens: 128_000 },
        });

        const credential = createCredential(options, {
          provider: "deepseek",
          label: "DeepSeek Key",
          apiKey: "sk-super-secret",
          clientSessionId: "bs_test",
        });
        expect(credential).toMatchObject({
          label: "DeepSeek Key",
          provider: "deepseek",
          masked: "••••••",
        });
        expect(JSON.stringify(credential)).not.toContain("sk-super-secret");
        expect(JSON.stringify(listCredentialDtos(options))).not.toContain("sk-super-secret");

        const secretRow = opened.sqlite
          .prepare("SELECT ciphertext, nonce, tag FROM secrets")
          .get() as { ciphertext: string; nonce: string; tag: string };
        expect(secretRow.ciphertext).not.toContain("sk-super-secret");

        const audit = JSON.stringify(listRecentAudit(opened.db));
        expect(audit).not.toContain("sk-super-secret");
        expect(audit).toContain("credential.created");

        const resolved = resolveModel(options, null);
        expect(resolved).toMatchObject({
          profile: { id: "deepseek-default", model: "deepseek-chat" },
          apiKey: "sk-super-secret",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("uses the latest provider credential when a profile has no explicit credential", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        createCredential(options, { provider: "deepseek", label: "first", apiKey: "key-one" });
        const second = createCredential(options, {
          provider: "deepseek",
          label: "second",
          apiKey: "key-two",
        });
        expect(resolveModel(options, "deepseek-default")?.apiKey).toBe("key-two");

        const explicit = createModelProfile(options, {
          label: "DeepSeek explicit",
          provider: "deepseek",
          model: "deepseek-chat",
          credentialProfileId: second.id,
        });
        expect(explicit.credentialLabel).toBe("second");
        expect(resolveModel(options, explicit.id)?.apiKey).toBe("key-two");
        expect(listModelDtos(options).map((model) => model.id)).toContain(explicit.id);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects deleting a referenced credential but removes unreferenced secrets", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        const used = createCredential(options, {
          provider: "deepseek",
          label: "used",
          apiKey: "used-key",
        });
        createModelProfile(options, {
          label: "explicit",
          provider: "deepseek",
          model: "deepseek-chat",
          credentialProfileId: used.id,
        });

        expect(() => deleteCredential(options, { id: used.id })).toThrowError(
          expect.objectContaining({ code: "CONFLICT" }),
        );

        const unused = createCredential(options, {
          provider: "deepseek",
          label: "unused",
          apiKey: "unused-key",
        });
        deleteCredential(options, { id: unused.id });
        expect(listCredentialDtos(options).map((item) => item.id)).not.toContain(unused.id);
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM secrets").get()).toEqual({ n: 1 });
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed when the master key cannot decrypt a credential", async () => {
    await withTempDir(async (first) => {
      await withTempDir(async (second) => {
        const { opened, options } = await fixture(first);
        createCredential(options, {
          provider: "deepseek",
          label: "key",
          apiKey: "secret",
        });
        const otherStore = await SecretStore.open(second);

        try {
          expect(() => resolveModel({ ...options, secretStore: otherStore }, null)).toThrowError(
            expect.objectContaining({ code: "PROVIDER_AUTH_FAILED" }),
          );
        } finally {
          opened.close();
        }
      });
    });
  });

  it("rejects invalid model profiles and credentials from unknown providers", async () => {
    await withTempDir(async (dir) => {
      const { opened, options } = await fixture(dir);

      try {
        expect(() =>
          createCredential(options, {
            provider: "nope" as never,
            label: "x",
            apiKey: "key",
          }),
        ).toThrowError(ModelError);

        expect(() =>
          createModelProfile(options, {
            label: "",
            provider: "deepseek",
            model: "deepseek-chat",
          }),
        ).toThrowError(ModelError);

        expect(() =>
          createModelProfile(options, {
            label: "x",
            provider: "deepseek",
            model: "deepseek-chat",
            credentialProfileId: "cred_missing",
          }),
        ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
      } finally {
        opened.close();
      }
    });
  });
});
