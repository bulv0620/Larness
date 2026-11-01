import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { executeTool } from "../../src/modules/agent/toolExecutor.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

const PATCH = "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n";

describe("tool executor", () => {
  it("audits reads and gates strict writes through approval", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      const projectRoot = path.join(dir, "project");
      await mkdir(projectRoot);
      await writeFile(path.join(projectRoot, "a.txt"), "one\ntwo\n");
      const realRoot = await realpath(projectRoot);
      const clock = { value: 1_000 };
      const options = { db: opened.db, dataDir: dir, now: () => clock.value };
      const session = await createSession(options, {});
      const turn = createTurn(options, { sessionId: session.id, text: "edit" });
      const registry = createFileToolRegistry();
      const executor = { db: opened.db, registry, now: () => clock.value };

      try {
        const read = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_read",
          toolName: "read_file",
          args: { path: "a.txt" },
          policy: "standard",
          projectRoot: realRoot,
        });
        expect(read.status).toBe("completed");
        if (read.status === "completed") {
          expect(read.result).toMatchObject({ ok: true });
        }

        const firstPatch = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_patch",
          toolName: "apply_patch",
          args: {
            path: "a.txt",
            expectedVersion:
              read.status === "completed" ? (read.result.data as { version: string }).version : "",
            patch: PATCH,
          },
          policy: "strict",
          projectRoot: realRoot,
        });
        expect(firstPatch.status).toBe("approval_required");

        if (firstPatch.status !== "approval_required") {
          throw new Error("expected approval");
        }

        decideApproval(
          { db: opened.db, now: () => clock.value },
          {
            id: firstPatch.approval.id,
            decision: "approve",
            decidedBy: "bs_test",
            clientSessionId: "bs_test",
          },
        );

        const applied = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_patch",
          toolName: "apply_patch",
          args: {
            path: "a.txt",
            expectedVersion:
              read.status === "completed" ? (read.result.data as { version: string }).version : "",
            patch: PATCH,
          },
          policy: "strict",
          projectRoot: realRoot,
          approvalId: firstPatch.approval.id,
          clientSessionId: "bs_test",
        });
        expect(applied.status).toBe("completed");
        if (applied.status === "completed") {
          expect(applied.result).toMatchObject({ ok: true });
        }
        expect(await readFile(path.join(realRoot, "a.txt"), "utf8")).toBe("one\nTWO\n");

        const actions = listRecentAudit(opened.db).map((row) => row.action);
        expect(actions).toContain("tool.requested");
        expect(actions).toContain("tool.completed");
        expect(actions).toContain("approval.granted");
      } finally {
        opened.close();
      }
    });
  });

  it("rejects tampered approvals, readonly writes and path escapes", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      const projectRoot = path.join(dir, "project");
      await mkdir(projectRoot);
      await writeFile(path.join(projectRoot, "a.txt"), "one\ntwo\n");
      const realRoot = await realpath(projectRoot);
      const clock = { value: 1_000 };
      const sessionOptions = { db: opened.db, dataDir: dir, now: () => clock.value };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "edit" });
      const registry = createFileToolRegistry();
      const executor = { db: opened.db, registry, now: () => clock.value };

      try {
        const read = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_read",
          toolName: "read_file",
          args: { path: "a.txt" },
          policy: "standard",
          projectRoot: realRoot,
        });
        const version = (read.status === "completed" ? read.result.data : {}) as {
          version?: string;
        };

        const approvalOutcome = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_patch",
          toolName: "apply_patch",
          args: { path: "a.txt", expectedVersion: version.version ?? "", patch: PATCH },
          policy: "strict",
          projectRoot: realRoot,
        });

        if (approvalOutcome.status !== "approval_required") {
          throw new Error("expected approval");
        }

        decideApproval(
          { db: opened.db, now: () => clock.value },
          {
            id: approvalOutcome.approval.id,
            decision: "approve",
            decidedBy: "bs_test",
          },
        );

        const tampered = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_patch",
          toolName: "apply_patch",
          args: {
            path: "a.txt",
            expectedVersion: version.version ?? "",
            patch: PATCH.replace("TWO", "THREE"),
          },
          policy: "strict",
          projectRoot: realRoot,
          approvalId: approvalOutcome.approval.id,
          clientSessionId: "bs_test",
        });
        expect(tampered.status).toBe("completed");
        if (tampered.status === "completed") {
          expect(tampered.result).toMatchObject({ ok: false, errorCode: "APPROVAL_INVALID" });
        }
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("approval.invalid");

        const readonly = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_readonly",
          toolName: "apply_patch",
          args: { path: "a.txt", expectedVersion: version.version ?? "", patch: PATCH },
          policy: "readonly",
          projectRoot: realRoot,
        });
        expect(readonly.status).toBe("completed");
        if (readonly.status === "completed") {
          expect(readonly.result).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
        }

        const escaped = await executeTool(executor, {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_escape",
          toolName: "read_file",
          args: { path: "../outside.txt" },
          policy: "standard",
          projectRoot: realRoot,
        });
        expect(escaped.status).toBe("completed");
        if (escaped.status === "completed") {
          expect(escaped.result).toMatchObject({
            ok: false,
            errorCode: "PATH_OUTSIDE_PROJECT",
          });
        }
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("tool.denied");
      } finally {
        opened.close();
      }
    });
  });
});
