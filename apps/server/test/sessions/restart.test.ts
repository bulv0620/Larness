import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { createLogSink, withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("restart repair", () => {
  it("marks a turn that was active during shutdown as INTERRUPTED after restart", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);

      const sessionResponse = await started.running.app.inject({
        method: "POST",
        url: "/api/sessions",
        headers: {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        },
        payload: {},
      });
      const session = sessionResponse.json() as { id: string };

      const turnResponse = await started.running.app.inject({
        method: "POST",
        url: `/api/sessions/${session.id}/turns`,
        headers: {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
          "idempotency-key": "restart-1",
        },
        payload: { input: "long running" },
      });
      expect(turnResponse.statusCode).toBe(202);
      const turn = turnResponse.json() as { turnId: string };

      await stopAuthorizedServer(started);

      const restarted = await startServer({
        env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(started.port) },
        logDestination: createLogSink().stream,
      });

      try {
        const row = restarted.sqlite
          .prepare("SELECT status, ended_at, error_json FROM turns WHERE id = ?")
          .get(turn.turnId) as {
          status: string;
          ended_at: number | null;
          error_json: string | null;
        };
        expect(row.status).toBe("INTERRUPTED");
        expect(row.ended_at).not.toBeNull();
        expect(JSON.parse(row.error_json ?? "{}")).toMatchObject({ code: "INTERRUPTED" });

        const detail = await restarted.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { cookie: started.cookie },
        });
        expect(detail.json()).toMatchObject({
          status: "active",
          activeTurn: null,
        });

        const events = await restarted.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events?after=0`,
          headers: { cookie: started.cookie },
        });
        const body = events.json() as {
          items: { type: string; sequence: number; payload: unknown }[];
        };
        expect(body.items.map((event) => event.type)).toEqual([
          "user.message",
          "turn.created",
          "turn.interrupted",
        ]);
        expect(body.items.map((event) => event.sequence)).toEqual([1, 2, 3]);
        expect(body.items[2]?.payload).toMatchObject({ turnId: turn.turnId });
      } finally {
        await restarted.shutdown("test");
      }
    });
  });
});
