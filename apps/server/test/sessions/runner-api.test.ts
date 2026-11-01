import { createFakeProvider } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("condition not met in time");
}

describe("turn runner API integration", () => {
  it("runs a created turn through the queue and persists the result", async () => {
    await withTempDir(async (dir) => {
      const provider = createFakeProvider([
        {
          chunks: [
            { type: "text-delta", text: "finished" },
            { type: "finish", finishReason: "stop" },
          ],
        },
      ]);
      const started = await startAuthorizedServer(dir, {
        turnRunner: true,
        providerResolver: () => ({ adapter: provider, model: "fake" }),
      });

      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const sessionResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: auth,
          payload: {},
        });
        const session = sessionResponse.json() as { id: string };
        const turnResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/turns`,
          headers: { ...auth, "idempotency-key": "runner-1" },
          payload: { input: "run" },
        });
        expect(turnResponse.statusCode).toBe(202);
        const turn = turnResponse.json() as { turnId: string };

        await waitFor(
          () =>
            (
              started.running.sqlite
                .prepare("SELECT status FROM turns WHERE id = ?")
                .get(turn.turnId) as { status: string }
            ).status === "COMPLETED",
        );

        const events = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events`,
          headers: { cookie: started.cookie },
        });
        const body = events.json() as { items: { type: string }[] };
        expect(body.items.map((item) => item.type)).toEqual(
          expect.arrayContaining(["assistant.message", "turn.completed"]),
        );

        const detail = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { cookie: started.cookie },
        });
        expect(detail.json()).toMatchObject({ activeTurn: null });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("cancels a running turn through the API", async () => {
    await withTempDir(async (dir) => {
      const provider = createFakeProvider([
        { delayMs: 2_000, chunks: [{ type: "text-delta", text: "too late" }] },
      ]);
      const started = await startAuthorizedServer(dir, {
        turnRunner: true,
        providerResolver: () => ({ adapter: provider, model: "fake" }),
      });

      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const session = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/sessions",
            headers: auth,
            payload: {},
          })
        ).json() as { id: string };
        const turn = (
          await started.running.app.inject({
            method: "POST",
            url: `/api/sessions/${session.id}/turns`,
            headers: { ...auth, "idempotency-key": "runner-cancel" },
            payload: { input: "slow" },
          })
        ).json() as { turnId: string };

        await waitFor(
          () =>
            (
              started.running.sqlite
                .prepare("SELECT status FROM turns WHERE id = ?")
                .get(turn.turnId) as { status: string }
            ).status === "RUNNING",
        );

        const cancelled = await started.running.app.inject({
          method: "POST",
          url: `/api/turns/${turn.turnId}/cancel`,
          headers: auth,
          payload: {},
        });
        expect(cancelled.statusCode).toBe(200);
        expect(cancelled.json()).toMatchObject({ status: "CANCELLING" });

        await waitFor(
          () =>
            (
              started.running.sqlite
                .prepare("SELECT status FROM turns WHERE id = ?")
                .get(turn.turnId) as { status: string }
            ).status === "CANCELLED",
        );

        const events = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events`,
          headers: { cookie: started.cookie },
        });
        expect(
          (events.json() as { items: { type: string }[] }).items.map((item) => item.type),
        ).toContain("turn.cancelled");
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
