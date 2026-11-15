import path from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { refreshModelCatalog } from "../../src/modules/models/catalog.js";
import { createCredential } from "../../src/modules/models/service.js";
import { createSessionRow } from "../../src/modules/sessions/repository.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

it("discovers native workspace models and keeps subscription credentials on their own route", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    const secretStore = await SecretStore.open(dir);
    const options = { db: opened.db, secretStore };
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      const standard = createCredential(options, {
        presetId: "bailian-workspace-cn",
        workspaceId: "llm-workspace",
        label: "Workspace",
        apiKey: "fixture-standard",
      });
      const subscription = createCredential(options, {
        presetId: "bailian-coding",
        label: "Coding",
        apiKey: "fixture-coding",
      });
      expect(standard.endpoint).toBe(
        "https://llm-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      );
      expect(subscription.billing).toBe("subscription");
      fetcher
        .mockResolvedValueOnce(
          Response.json({
            output: {
              total: 2,
              page_size: 1,
              models: [
                {
                  model: "qwen-one",
                  model_info: { context_window: 128_000 },
                  features: ["function-calling"],
                },
              ],
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            output: {
              total: 2,
              page_size: 1,
              models: [
                {
                  model: "qwen-two",
                  model_info: { max_input_tokens: 64_000, max_output_tokens: 4096 },
                },
              ],
            },
          }),
        );
      const catalog = await refreshModelCatalog(options, { credentialProfileId: standard.id });
      expect(
        catalog.groups
          .find((group) => group.credentialProfileId === standard.id)
          ?.models.map((model) => model.id),
      ).toEqual(["qwen-one", "qwen-two"]);
      const secondPage = new URL(String(fetcher.mock.calls[1]?.[0]));
      expect(secondPage.pathname).toBe("/api/v1/models");
      expect(secondPage.searchParams.get("page_no")).toBe("2");
      expect(secondPage.searchParams.get("capabilities")).toBe("TG");
      expect(fetcher.mock.calls).toHaveLength(2);
      const candidates = await refreshModelCatalog(
        {
          ...options,
          publicDirectoryFetcher: async () => ({
            "alibaba-coding-plan-cn": {
              models: {
                "qwen3.7-plus": {
                  limit: { context: 100_000 },
                  modalities: { input: ["text"], output: ["text"] },
                  tool_call: true,
                },
              },
            },
          }),
        },
        { credentialProfileId: subscription.id, includePublicDirectory: true },
      );
      expect(
        candidates.groups.find((group) => group.credentialProfileId === subscription.id),
      ).toMatchObject({
        candidatesOnly: true,
        models: expect.arrayContaining([
          expect.objectContaining({
            id: "qwen3.7-plus",
            agentSelectable: true,
            thinking: expect.objectContaining({
              levels: expect.arrayContaining([{ id: "effort:none", label: "关闭" }]),
            }),
          }),
        ]),
      });
      expect(fetcher.mock.calls).toHaveLength(2);
      const session = createSessionRow(opened.db, {
        id: "sess-scheduled",
        modelProfileId: null,
        approvalPolicyId: "readonly",
        projectId: null,
        workspacePath: dir,
        title: "scheduled",
        origin: "scheduled",
        now: 1000,
      });
      expect(() =>
        createTurn(options, {
          sessionId: session.id,
          text: "run",
          model: "qwen3.7-plus",
          credentialProfileId: subscription.id,
        }),
      ).toThrow(/only supports interactive sessions/);
    } finally {
      fetcher.mockRestore();
      opened.close();
    }
  });
});
