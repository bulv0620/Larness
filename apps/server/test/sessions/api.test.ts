import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("sessions API", () => {
  it("runs the session, turn, event and archive lifecycle", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);

      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };

        const empty = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: started.cookie },
        });
        expect(empty.json()).toEqual({ sessions: [] });

        const createdResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: auth,
          payload: {},
        });
        expect(createdResponse.statusCode).toBe(201);
        const session = createdResponse.json() as {
          id: string;
          workspacePath: string;
          status: string;
          title: string;
        };
        expect(session.title).toBe("New session");
        expect(session.workspacePath).toBe(
          path.join(dir, "sessions", "global-terminal", "workspace"),
        );
        expect((await stat(session.workspacePath)).isDirectory()).toBe(true);

        const list = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: started.cookie },
        });
        expect(list.json()).toMatchObject({ sessions: [{ id: session.id }] });

        const detail = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { cookie: started.cookie },
        });
        expect(detail.json()).toMatchObject({
          id: session.id,
          status: "active",
          activeTurn: null,
        });

        const turnResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/turns`,
          headers: { ...auth, "idempotency-key": "key-1" },
          payload: { input: "hello" },
        });
        expect(turnResponse.statusCode).toBe(202);
        const turn = turnResponse.json() as { turnId: string; status: string };

        const retry = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/turns`,
          headers: { ...auth, "idempotency-key": "key-1" },
          payload: { input: "hello again" },
        });
        expect(retry.json()).toMatchObject({ turnId: turn.turnId, status: turn.status });

        const conflict = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/turns`,
          headers: { ...auth, "idempotency-key": "key-2" },
          payload: { input: "another" },
        });
        expect(conflict.statusCode).toBe(409);
        expect(conflict.json()).toMatchObject({ error: { code: "TURN_IN_PROGRESS" } });

        const firstPage = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events?after=0&limit=1`,
          headers: { cookie: started.cookie },
        });
        expect(firstPage.json()).toMatchObject({
          items: [{ sequence: 1, type: "user.message" }],
          nextSeq: 1,
          hasMore: true,
        });

        const secondPage = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events?after=1`,
          headers: { cookie: started.cookie },
        });
        expect(secondPage.json()).toMatchObject({
          items: [{ sequence: 2, type: "turn.created" }],
          nextSeq: 2,
          hasMore: false,
        });

        const invalidAfter = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}/events?after=-1`,
          headers: { cookie: started.cookie },
        });
        expect(invalidAfter.statusCode).toBe(400);

        const renamed = await started.running.app.inject({
          method: "PATCH",
          url: `/api/sessions/${session.id}`,
          headers: auth,
          payload: {
            title: "Renamed",
            modelProfileId: "mdl_next",
            approvalPolicyId: "strict",
          },
        });
        expect(renamed.json()).toMatchObject({
          title: "Renamed",
          modelProfileId: "mdl_next",
          approvalPolicyId: "strict",
        });

        const cancelled = await started.running.app.inject({
          method: "POST",
          url: `/api/turns/${turn.turnId}/cancel`,
          headers: auth,
          payload: {},
        });
        expect(cancelled.json()).toMatchObject({
          turnId: turn.turnId,
          status: "CANCELLING",
        });

        const blockedDelete = await started.running.app.inject({
          method: "DELETE",
          url: `/api/sessions/${session.id}`,
          headers: auth,
        });
        expect(blockedDelete.statusCode).toBe(409);
        expect(blockedDelete.json()).toMatchObject({ error: { code: "TURN_IN_PROGRESS" } });

        started.running.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(turn.turnId);

        const deleted = await started.running.app.inject({
          method: "DELETE",
          url: `/api/sessions/${session.id}`,
          headers: auth,
        });
        expect(deleted.json()).toEqual({ ok: true });

        const archived = await started.running.app.inject({
          method: "GET",
          url: `/api/sessions/${session.id}`,
          headers: { cookie: started.cookie },
        });
        expect(archived.json()).toMatchObject({ status: "archived" });

        const hidden = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: started.cookie },
        });
        expect(hidden.json()).toEqual({ sessions: [] });

        const rejectedTurn = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${session.id}/turns`,
          headers: { ...auth, "idempotency-key": "key-3" },
          payload: { input: "too late" },
        });
        expect(rejectedTurn.statusCode).toBe(409);
        expect(rejectedTurn.json()).toMatchObject({ error: { code: "CONFLICT" } });

        await mkdir(path.join(dir, "project"), { recursive: true });
        const projectResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/projects",
          headers: auth,
          payload: { rootPath: path.join(dir, "project") },
        });
        expect(projectResponse.statusCode).toBe(201);
        const project = projectResponse.json() as { id: string; realPath: string };

        const projectSession = await started.running.app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: auth,
          payload: { projectId: project.id },
        });
        expect(projectSession.json()).toMatchObject({
          projectId: project.id,
          workspacePath: project.realPath,
        });

        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions",
        });
        expect(unauthenticated.statusCode).toBe(401);

        const missing = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions/ses_missing/events",
          headers: { cookie: started.cookie },
        });
        expect(missing.statusCode).toBe(404);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
