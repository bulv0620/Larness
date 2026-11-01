import { describe, expect, it } from "vitest";
import { requestApproval } from "../../src/modules/agent/approvalService.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("approvals API", () => {
  it("returns approval details and applies one authenticated decision", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);

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
          headers: { ...auth, "idempotency-key": "approval-1" },
          payload: { input: "edit a file" },
        });
        const turn = turnResponse.json() as { turnId: string };

        const approval = requestApproval(
          { db: started.running.db },
          {
            turnId: turn.turnId,
            toolCallId: "call_1",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "patch a.txt", risk: "L1" },
            params: { path: "a.txt", expectedVersion: "a".repeat(64), patch: "x" },
          },
        );

        const details = await started.running.app.inject({
          method: "GET",
          url: `/api/approvals/${approval.id}`,
          headers: { cookie: started.cookie },
        });
        expect(details.statusCode).toBe(200);
        expect(details.json()).toMatchObject({
          id: approval.id,
          status: "pending",
          scope: { summary: "patch a.txt" },
        });

        const approved = await started.running.app.inject({
          method: "POST",
          url: `/api/approvals/${approval.id}`,
          headers: auth,
          payload: { decision: "approve" },
        });
        expect(approved.statusCode).toBe(200);
        expect(approved.json()).toMatchObject({ status: "approved" });

        const repeated = await started.running.app.inject({
          method: "POST",
          url: `/api/approvals/${approval.id}`,
          headers: auth,
          payload: { decision: "reject" },
        });
        expect(repeated.statusCode).toBe(409);
        expect(repeated.json()).toMatchObject({ error: { code: "APPROVAL_INVALID" } });

        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: `/api/approvals/${approval.id}`,
        });
        expect(unauthenticated.statusCode).toBe(401);

        const missing = await started.running.app.inject({
          method: "GET",
          url: "/api/approvals/apv_missing",
          headers: { cookie: started.cookie },
        });
        expect(missing.statusCode).toBe(404);

        const second = requestApproval(
          { db: started.running.db },
          {
            turnId: turn.turnId,
            toolCallId: "call_2",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "patch b.txt" },
            params: { path: "b.txt", expectedVersion: "b".repeat(64), patch: "y" },
          },
        );
        started.running.sqlite
          .prepare("UPDATE approvals SET expires_at = 0 WHERE id = ?")
          .run(second.id);
        const expired = await started.running.app.inject({
          method: "GET",
          url: `/api/approvals/${second.id}`,
          headers: { cookie: started.cookie },
        });
        expect(expired.json()).toMatchObject({ status: "expired" });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
