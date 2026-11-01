import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import {
  assertApprovalMatches,
  decideApproval,
  expirePendingApprovals,
  getApproval,
  hashApprovalParams,
  requestApproval,
} from "../../src/modules/agent/approvalService.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

const PARAMS = {
  path: "a.txt",
  expectedVersion: "a".repeat(64),
  patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n",
};

describe("approval service", () => {
  it("creates a pending approval with a canonical parameter hash", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => 1_000 };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "edit" });
        const approval = requestApproval(
          { db: opened.db, now: () => 1_000 },
          {
            turnId: turn.turnId,
            toolCallId: "call_1",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "patch a.txt", risk: "L1" },
            params: PARAMS,
          },
        );

        expect(approval).toMatchObject({
          turnId: turn.turnId,
          toolCallId: "call_1",
          toolName: "apply_patch",
          risk: "L1",
          status: "pending",
          scope: { summary: "patch a.txt", risk: "L1" },
          expiresAt: 301_000,
          decidedAt: null,
          decidedBy: null,
        });
        expect(approval.paramsHash).toBe(hashApprovalParams(PARAMS));
        expect(hashApprovalParams({ b: 2, a: 1 })).toBe(hashApprovalParams({ a: 1, b: 2 }));

        expect(getApproval({ db: opened.db, now: () => 1_000 }, approval.id).status).toBe(
          "pending",
        );
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("approval.requested");
      } finally {
        opened.close();
      }
    });
  });

  it("enforces a single decision and binds execution params", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => 1_000 };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "edit" });
        const approval = requestApproval(
          { db: opened.db, now: () => 1_000 },
          {
            turnId: turn.turnId,
            toolCallId: "call_1",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "patch" },
            params: PARAMS,
          },
        );

        const approved = decideApproval(
          { db: opened.db, now: () => 1_500 },
          {
            id: approval.id,
            decision: "approve",
            decidedBy: "bs_test",
            clientSessionId: "bs_test",
          },
        );
        expect(approved).toMatchObject({
          status: "approved",
          decidedAt: 1_500,
          decidedBy: "bs_test",
        });
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("approval.granted");

        expect(() =>
          assertApprovalMatches(
            { db: opened.db, now: () => 1_600 },
            { id: approval.id, params: PARAMS },
          ),
        ).not.toThrow();

        expect(() =>
          assertApprovalMatches(
            { db: opened.db, now: () => 1_600 },
            { id: approval.id, params: { ...PARAMS, path: "b.txt" } },
          ),
        ).toThrowError(expect.objectContaining({ code: "APPROVAL_INVALID" }));
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("approval.invalid");

        expect(() =>
          decideApproval(
            { db: opened.db },
            { id: approval.id, decision: "reject", decidedBy: "bs_test" },
          ),
        ).toThrowError(expect.objectContaining({ code: "APPROVAL_INVALID" }));
      } finally {
        opened.close();
      }
    });
  });

  it("expires pending approvals and persists the timeout denial", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, dataDir: dir, now: () => clock.value };
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "edit" });
        const approval = requestApproval(
          { db: opened.db, now: () => clock.value },
          {
            turnId: turn.turnId,
            toolCallId: "call_1",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "patch" },
            params: PARAMS,
            ttlMs: 100,
          },
        );

        clock.value = 1_200;
        expect(getApproval({ db: opened.db, now: () => clock.value }, approval.id)).toMatchObject({
          status: "expired",
          decidedAt: 1_200,
        });
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("approval.expired");

        expect(() =>
          decideApproval(
            { db: opened.db, now: () => clock.value },
            { id: approval.id, decision: "approve", decidedBy: "bs_test" },
          ),
        ).toThrowError(expect.objectContaining({ code: "APPROVAL_INVALID" }));

        const row = opened.sqlite
          .prepare("SELECT status FROM approvals WHERE id = ?")
          .get(approval.id) as { status: string };
        expect(row.status).toBe("expired");
      } finally {
        opened.close();
      }
    });
  });

  it("expires pending approvals in bulk and rejects unknown turns", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, dataDir: dir, now: () => clock.value };
        const session = await createSession(options, {});
        const turnA = createTurn(options, { sessionId: session.id, text: "a" });
        const approvalA = requestApproval(
          { db: opened.db, now: () => clock.value },
          {
            turnId: turnA.turnId,
            toolCallId: "call_a",
            toolName: "apply_patch",
            risk: "L1",
            scope: { summary: "a" },
            params: PARAMS,
            ttlMs: 100,
          },
        );

        clock.value = 2_000;
        expect(expirePendingApprovals({ db: opened.db, now: () => clock.value })).toBe(1);
        expect(
          opened.sqlite.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalA.id),
        ).toEqual({ status: "expired" });

        expect(() =>
          requestApproval(
            { db: opened.db, now: () => clock.value },
            {
              turnId: "trn_missing",
              toolCallId: "call_x",
              toolName: "apply_patch",
              risk: "L1",
              scope: {},
              params: {},
            },
          ),
        ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
      } finally {
        opened.close();
      }
    });
  });
});
