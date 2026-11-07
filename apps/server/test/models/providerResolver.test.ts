import path from "node:path";
import { GLM_ENDPOINTS } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { createDefaultProviderResolver } from "../../src/bootstrap/start.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCredential } from "../../src/modules/models/service.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

describe("provider resolver", () => {
  it("passes the credential endpoint through to the turn runner", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      const store = await SecretStore.open(dir);

      try {
        const credential = createCredential(
          { db: opened.db, secretStore: store },
          {
            provider: "glm",
            label: "GLM Key",
            apiKey: "sk-glm",
            endpoint: GLM_ENDPOINTS.codingIntl,
          },
        );
        opened.sqlite
          .prepare(
            "INSERT INTO model_catalog_cache (credential_profile_id, provider, endpoint, models_json, synced_at, last_attempt_at, last_error_code) VALUES (?, 'glm', ?, ?, 5000, 5000, NULL)",
          )
          .run(
            credential.id,
            `${GLM_ENDPOINTS.codingIntl}/models`,
            JSON.stringify([
              {
                id: "glm-4.6",
                label: "GLM-4.6",
                contextWindow: 200_000,
                thinking: { supported: true, mode: "toggle", levels: [] },
                default: true,
              },
            ]),
          );

        const resolver = createDefaultProviderResolver(opened.db, store);
        const resolved = await resolver(
          {} as never,
          {
            model: "glm-4.6",
            thinking: "on",
            credentialProfileId: credential.id,
            modelProfileId: null,
          } as never,
        );

        expect(resolved).toMatchObject({
          adapter: { id: "glm" },
          model: "glm-4.6",
          endpoint: GLM_ENDPOINTS.codingIntl,
          thinking: { enabled: true },
        });
        expect(resolved.apiKey).toBe("sk-glm");
      } finally {
        opened.sqlite.close();
      }
    });
  });
});
