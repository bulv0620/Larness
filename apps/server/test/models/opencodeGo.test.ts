import path from "node:path";
import { expect, it, vi } from "vitest";
import { createDefaultProviderResolver } from "../../src/bootstrap/start.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { refreshModelCatalog } from "../../src/modules/models/catalog.js";
import { createCredential } from "../../src/modules/models/service.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

it("uses the Go inventory and sends the same Go session identifier across calls", async () => {
  await withTempDir(async (dir) => {
    const opened = openDatabase(path.join(dir, "test.db"));
    runMigrations(opened.db);
    const secretStore = await SecretStore.open(dir);
    const options = { db: opened.db, dataDir: dir, secretStore };
    const fetcher = vi.spyOn(globalThis, "fetch");
    try {
      const credential = createCredential(options, {
        presetId: "opencode-go",
        label: "Go",
        apiKey: "fixture",
      });
      fetcher.mockResolvedValueOnce(
        Response.json({
          data: [
            {
              id: "glm-5.3-flash",
              limit: { context: 900_000, output: 22_000 },
              modalities: { input: ["text", "image/png"] },
              capabilities: { tools: { supported: true } },
            },
            { id: "deepseek-v4.1-flash" },
          ],
        }),
      );
      const catalog = await refreshModelCatalog({
        ...options,
        publicDirectoryFetcher: async () => ({}),
      });
      expect(fetcher.mock.calls[0]?.[0]).toBe("https://opencode.ai/inference/go/v1/models");
      expect(catalog.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "glm-5.3-flash",
            agentSelectable: true,
            contextWindow: 900_000,
            capabilities: expect.objectContaining({
              maxOutputTokens: 22_000,
              inputModalities: ["text", "image"],
            }),
          }),
          expect.objectContaining({ id: "deepseek-v4.1-flash", agentSelectable: true }),
        ]),
      );
      const session = await createSession(options, {});
      const { turnId } = createTurn(options, {
        sessionId: session.id,
        text: "scratch",
        model: "glm-5.3-flash",
        credentialProfileId: credential.id,
      });
      const sessionRow = getSessionById(opened.db, session.id);
      const turn = getTurnById(opened.db, turnId);
      if (!sessionRow || !turn) throw new Error("missing rows");
      const resolved = await createDefaultProviderResolver(opened.db, secretStore)(
        sessionRow,
        turn,
      );
      const headers: string[] = [];
      fetcher.mockImplementation(async (url, input) => {
        expect(String(url)).toBe("https://opencode.ai/inference/go/openai/v1/chat/completions");
        headers.push(new Headers(input?.headers).get("x-opencode-session") ?? "");
        const chunk = {
          id: "test",
          object: "chat.completion.chunk",
          created: 1,
          model: resolved.model,
          choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      });
      for (const role of ["first", "second"]) {
        const chunks = [];
        for await (const chunk of resolved.adapter.streamStep({
          model: resolved.model,
          apiKey: resolved.apiKey,
          endpoint: resolved.endpoint,
          messages: [{ role: "user", content: role }],
          tools: [],
          signal: new AbortController().signal,
        }))
          chunks.push(chunk);
        expect(chunks).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "text-delta", text: "ok" })]),
        );
      }
      expect(headers).toHaveLength(2);
      expect(headers[0]).toMatch(/^ses_[a-f0-9]+$/);
      expect(headers[1]).toBe(headers[0]);
      expect(headers[0]).not.toBe(session.id);
    } finally {
      fetcher.mockRestore();
      opened.close();
    }
  });
});
