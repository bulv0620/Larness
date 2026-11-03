import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  type ProviderChunk,
  ProviderError,
} from "@larness/agent";
import type { AssistantDeltaEvent, ServerEvent } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
    ],
  };
}

function toolStep(toolCall: { id: string; name: string; args: unknown }): {
  chunks: ProviderChunk[];
} {
  return {
    chunks: [
      { type: "tool-call", toolCall },
      { type: "finish", finishReason: "tool-calls" },
    ],
  };
}

function patchFor(original: string, next: string): string {
  const before = original.replace(/\n$/, "");
  const after = next.replace(/\n$/, "");
  return `--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-${before}\n+${after}\n`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("condition not met in time");
}

describe("TurnRunner", () => {
  it("runs a text-only turn, persists events and records usage", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "hello" });
        const provider = createFakeProvider([textStep("hi there")]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
        });

        const result = await runner.run(turn.turnId);
        expect(result.status).toBe("COMPLETED");

        const row = opened.sqlite
          .prepare("SELECT status, usage_json, ended_at FROM turns WHERE id = ?")
          .get(turn.turnId) as { status: string; usage_json: string; ended_at: number };
        expect(row.status).toBe("COMPLETED");
        expect(JSON.parse(row.usage_json)).toMatchObject({ totalTokens: 5 });
        expect(row.ended_at).not.toBeNull();

        const types = published.map((event) => event.type);
        expect(types).toContain("turn.status");
        expect(types).toContain("assistant.message");
        expect(types).toContain("turn.completed");
        expect(published.at(-1)?.payload).toMatchObject({
          turnId: turn.turnId,
          status: "COMPLETED",
        });

        const sequences = published.map((event) => event.sequence);
        expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
        expect(new Set(sequences).size).toBe(sequences.length);

        expect(provider.calls[0]?.tools.map((tool) => tool.name)).toEqual([
          "list_files",
          "read_file",
          "search_code",
          "apply_patch",
        ]);
        expect(provider.calls[0]?.messages[0]?.role).toBe("system");
      } finally {
        opened.close();
      }
    });
  });

  it("broadcasts ephemeral assistant deltas that share the final message id", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "stream" });
        const provider = createFakeProvider([textStep("hello world")]);
        const streamed: Array<ServerEvent | AssistantDeltaEvent> = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => streamed.push(event),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const deltas = streamed.filter(
          (event): event is AssistantDeltaEvent => event.kind === "assistant.delta",
        );
        expect(deltas).toHaveLength(1);
        expect(deltas[0]).toMatchObject({
          sessionId: session.id,
          turnId: turn.turnId,
          text: "hello world",
        });

        const message = streamed.find(
          (event): event is ServerEvent => "type" in event && event.type === "assistant.message",
        );
        expect(message?.payload).toMatchObject({
          messageId: deltas[0]?.messageId,
          text: "hello world",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("executes a standard-policy patch and records tool/file events", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const file = path.join(session.workspacePath, "a.txt");
        await writeFile(file, "old\n");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "patch it" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: { path: "a.txt", expectedVersion: version, patch: patchFor("old\n", "new\n") },
          }),
          textStep("done"),
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
        });

        const result = await runner.run(turn.turnId);
        expect(result.status).toBe("COMPLETED");
        expect(await readFile(file, "utf8")).toBe("new\n");
        expect(provider.calls).toHaveLength(2);

        const types = published.map((event) => event.type);
        expect(types).toEqual(
          expect.arrayContaining([
            "tool.requested",
            "tool.started",
            "tool.completed",
            "file.changed",
            "assistant.message",
            "turn.completed",
          ]),
        );
        expect(published.find((event) => event.type === "tool.completed")?.payload).toMatchObject({
          resourceTarget: { kind: "file", scope: { sessionId: session.id }, path: "a.txt" },
        });
        expect(published.find((event) => event.type === "file.changed")?.payload).toMatchObject({
          path: "a.txt",
          changeType: "modified",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("acquires and releases the project write lock for write tools", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const projectRoot = path.join(dir, "project");
        await mkdir(projectRoot);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false, now: () => 1 },
          { rootPath: projectRoot },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        await writeFile(path.join(projectRoot, "a.txt"), "old\n");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "patch" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: { path: "a.txt", expectedVersion: version, patch: patchFor("old\n", "new\n") },
          }),
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: () => undefined,
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        expect(await readFile(path.join(projectRoot, "a.txt"), "utf8")).toBe("new\n");

        const lock = opened.sqlite
          .prepare(
            "SELECT fencing_token, expires_at FROM resource_locks WHERE resource_type = 'project'",
          )
          .get() as { fencing_token: number; expires_at: number };
        expect(lock.fencing_token).toBe(1);
        expect(lock.expires_at).toBe(0);
      } finally {
        opened.close();
      }
    });
  });

  it("waits for strict approval and executes only after approval", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        opened.sqlite
          .prepare("UPDATE sessions SET approval_policy_id = 'strict' WHERE id = ?")
          .run(session.id);
        const file = path.join(session.workspacePath, "a.txt");
        await writeFile(file, "old\n");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "patch" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: { path: "a.txt", expectedVersion: version, patch: patchFor("old\n", "new\n") },
          }),
          textStep("done"),
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
          approvalPollMs: 5,
        });
        const running = runner.run(turn.turnId);

        await waitFor(
          () =>
            (
              opened.sqlite
                .prepare("SELECT count(*) AS n FROM approvals WHERE status = 'pending'")
                .get() as { n: number }
            ).n === 1,
        );
        const waiting = opened.sqlite
          .prepare("SELECT status FROM turns WHERE id = ?")
          .get(turn.turnId) as { status: string };
        expect(waiting.status).toBe("WAITING_APPROVAL");
        expect(await readFile(file, "utf8")).toBe("old\n");

        const approval = opened.sqlite.prepare("SELECT id FROM approvals LIMIT 1").get() as {
          id: string;
        };
        decideApproval(
          { db: opened.db },
          { id: approval.id, decision: "approve", decidedBy: "bs_test" },
        );

        const result = await running;
        expect(result.status).toBe("COMPLETED");
        expect(await readFile(file, "utf8")).toBe("new\n");
        expect(published.map((event) => event.type)).toEqual(
          expect.arrayContaining(["tool.approval.required", "tool.approval.resolved"]),
        );
        expect(
          published.find((event) => event.type === "tool.approval.resolved")?.payload,
        ).toMatchObject({ decision: "approved" });
      } finally {
        opened.close();
      }
    });
  });

  it("returns a denied tool result to the model and continues", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        opened.sqlite
          .prepare("UPDATE sessions SET approval_policy_id = 'strict' WHERE id = ?")
          .run(session.id);
        const file = path.join(session.workspacePath, "a.txt");
        await writeFile(file, "old\n");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "patch" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: { path: "a.txt", expectedVersion: version, patch: patchFor("old\n", "new\n") },
          }),
          textStep("I could not change it"),
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
          approvalPollMs: 5,
        });
        const running = runner.run(turn.turnId);

        await waitFor(
          () =>
            (
              opened.sqlite
                .prepare("SELECT count(*) AS n FROM approvals WHERE status = 'pending'")
                .get() as { n: number }
            ).n === 1,
        );
        const approval = opened.sqlite.prepare("SELECT id FROM approvals LIMIT 1").get() as {
          id: string;
        };
        decideApproval(
          { db: opened.db },
          { id: approval.id, decision: "reject", decidedBy: "bs_test" },
        );

        const result = await running;
        expect(result.status).toBe("COMPLETED");
        expect(await readFile(file, "utf8")).toBe("old\n");
        expect(published.find((event) => event.type === "tool.failed")?.payload).toMatchObject({
          errorCode: "APPROVAL_DENIED",
        });
        expect(published.map((event) => event.type)).toContain("turn.completed");
      } finally {
        opened.close();
      }
    });
  });

  it("denies an approval that times out", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        opened.sqlite
          .prepare("UPDATE sessions SET approval_policy_id = 'strict' WHERE id = ?")
          .run(session.id);
        await writeFile(path.join(session.workspacePath, "a.txt"), "old\n");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "patch" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: {
              path: "a.txt",
              expectedVersion: createHash("sha256").update("old\n").digest("hex"),
              patch: patchFor("old\n", "new\n"),
            },
          }),
          textStep("timed out"),
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
          approvalPollMs: 5,
          approvalTtlMs: 20,
        });

        const result = await runner.run(turn.turnId);
        expect(result.status).toBe("COMPLETED");
        expect(
          published.find((event) => event.type === "tool.approval.resolved")?.payload,
        ).toMatchObject({ decision: "expired" });
      } finally {
        opened.close();
      }
    });
  });

  it("cancels a running turn without starting tool calls", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "slow" });
        const provider = createFakeProvider([
          { delayMs: 2_000, chunks: [{ type: "text-delta", text: "late" }] },
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
        });

        const running = runner.run(turn.turnId);
        await waitFor(
          () =>
            (
              opened.sqlite.prepare("SELECT status FROM turns WHERE id = ?").get(turn.turnId) as {
                status: string;
              }
            ).status === "RUNNING",
        );
        expect(runner.cancel(turn.turnId)).toBe(true);

        const result = await running;
        expect(result.status).toBe("CANCELLED");
        expect(published.map((event) => event.type)).toContain("turn.cancelled");
        expect(published.map((event) => event.type)).not.toContain("tool.requested");
      } finally {
        opened.close();
      }
    });
  });

  it("maps provider failures to FAILED with a stable code", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "fail" });
        const provider = createFakeProvider([
          {
            chunks: [
              {
                type: "error",
                error: new ProviderError("PROVIDER_RATE_LIMITED", "rate limited"),
              },
            ],
          },
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: () => undefined,
        });

        const result = await runner.run(turn.turnId);
        expect(result).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_RATE_LIMITED" });
        const row = opened.sqlite
          .prepare("SELECT error_json FROM turns WHERE id = ?")
          .get(turn.turnId) as { error_json: string };
        expect(JSON.parse(row.error_json)).toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
      } finally {
        opened.close();
      }
    });
  });

  it("stops at the step budget and reports budget exhaustion", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "loop" });
        const provider = createFakeProvider([
          toolStep({ id: "call_list", name: "list_files", args: {} }),
          textStep("never used"),
        ]);
        const published: ServerEvent[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            if ("sequence" in event) published.push(event);
          },
          budget: { maxSteps: 1 },
        });

        const result = await runner.run(turn.turnId);
        expect(result.status).toBe("COMPLETED");
        expect(provider.calls).toHaveLength(1);
        expect(published.find((event) => event.type === "turn.completed")?.payload).toMatchObject({
          budgetExhausted: true,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("snapshots the model per turn and uses the session model for the next turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "first",
          modelProfileId: "model-a",
        });
        opened.sqlite
          .prepare("UPDATE sessions SET model_profile_id = 'model-b' WHERE id = ?")
          .run(session.id);
        const provider = createFakeProvider([textStep("first done"), textStep("second done")]);
        const models: string[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: (currentSession, currentTurn) => {
            const model = currentTurn.modelProfileId ?? currentSession.modelProfileId ?? "default";
            models.push(model);
            return { adapter: provider, model };
          },
          publish: () => undefined,
        });

        expect((await runner.run(first.turnId)).status).toBe("COMPLETED");
        const snapshot = opened.sqlite
          .prepare("SELECT provider, model FROM turns WHERE id = ?")
          .get(first.turnId) as { provider: string; model: string };
        expect(snapshot).toMatchObject({ provider: "fake", model: "model-a" });
        const second = createTurn(sessionOptions, { sessionId: session.id, text: "second" });
        expect((await runner.run(second.turnId)).status).toBe("COMPLETED");
        expect(models).toEqual(["model-a", "model-b"]);
      } finally {
        opened.close();
      }
    });
  });
});
