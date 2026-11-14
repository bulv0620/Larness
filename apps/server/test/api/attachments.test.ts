import { createFakeProvider } from "@larness/agent";
import { expect, it, vi } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a44QAAAAASUVORK5CYII=";

it("stores screenshot bytes behind their session and refuses image input to text-only models", async () => {
  await withTempDir(async (dir) => {
    const fake = createFakeProvider([
      {
        chunks: [
          {
            type: "tool-call",
            toolCall: {
              id: "one",
              name: "update_plan",
              args: { steps: [{ id: "inspect", title: "Inspect", status: "done" }] },
            },
          },
          { type: "finish", finishReason: "tool-calls" },
        ],
      },
      {
        chunks: [
          { type: "text-delta", text: "done" },
          { type: "finish", finishReason: "stop" },
        ],
      },
    ]);
    let imageSupport = false;
    const started = await startAuthorizedServer(dir, {
      turnRunner: true,
      providerResolver: () => ({ adapter: fake, model: "deepseek-flash" }),
      catalogFetcher: async () => ({
        data: [
          { id: "deepseek-flash", input_modalities: imageSupport ? ["text", "image"] : ["text"] },
        ],
      }),
    });
    const { app } = started.running;
    const headers = {
      cookie: started.cookie,
      origin: started.origin,
      "x-csrf-token": started.csrf,
    };
    try {
      const session = async () =>
        (
          await app.inject({
            method: "POST",
            url: "/api/sessions",
            headers,
            payload: {},
          })
        ).json<{ id: string }>().id;
      const owner = await session();
      const other = await session();
      const created = await app.inject({
        method: "POST",
        url: `/api/sessions/${owner}/attachments`,
        headers,
        payload: { mime: "image/png", data: tinyPng },
      });
      expect(created.statusCode).toBe(201);
      const { id } = created.json<{ id: string }>();
      const ownUrl = `/api/sessions/${owner}/attachments/${id}`;
      expect((await app.inject(ownUrl)).statusCode).toBe(401);
      expect(
        (await app.inject({ url: `/api/sessions/${other}/attachments/${id}`, headers })).statusCode,
      ).toBe(404);
      const downloaded = await app.inject({ url: ownUrl, headers });
      expect(downloaded.rawPayload.toString("base64")).toBe(tinyPng);
      const credential = (
        await app.inject({
          method: "POST",
          url: "/api/credentials",
          headers,
          payload: { provider: "deepseek", label: "deepseek", apiKey: "fixture" },
        })
      ).json<{ id: string }>();
      await app.inject({
        method: "POST",
        url: "/api/models/catalog/refresh",
        headers,
        payload: {},
      });
      const turn = await app.inject({
        method: "POST",
        url: `/api/sessions/${owner}/turns`,
        headers,
        payload: {
          input: "see screenshot",
          model: "deepseek-flash",
          credentialProfileId: credential.id,
          attachmentIds: [id],
        },
      });
      expect(turn.json()).toMatchObject({ error: { code: "MODEL_UNSUPPORTED" } });
      expect(fake.calls).toHaveLength(0);
      imageSupport = true;
      await app.inject({
        method: "POST",
        url: "/api/models/catalog/refresh",
        headers,
        payload: {},
      });
      const postTurn = (sessionId: string) =>
        app.inject({
          method: "POST",
          url: `/api/sessions/${sessionId}/turns`,
          headers,
          payload: {
            input: "",
            model: "deepseek-flash",
            credentialProfileId: credential.id,
            attachmentIds: [id],
          },
        });
      expect((await postTurn(other)).statusCode).toBe(404);
      expect((await postTurn(owner)).statusCode).toBe(202);
      await vi.waitFor(() => expect(fake.calls).toHaveLength(2));
      for (const call of fake.calls) {
        expect(call.messages).toContainEqual(
          expect.objectContaining({
            role: "user",
            images: [
              {
                bytes: Buffer.from(tinyPng, "base64"),
                mediaType: "image/png",
                width: 1,
                height: 1,
              },
            ],
          }),
        );
      }
      const events = await app.inject({ url: `/api/sessions/${owner}/events`, headers });
      expect(events.body).toContain(id);
      expect(events.body).not.toContain(tinyPng);
    } finally {
      await stopAuthorizedServer(started);
    }
  });
});
