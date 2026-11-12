import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  defineTool,
  type ProviderChunk,
  ProviderError,
} from "@larness/agent";
import type {
  AssistantDeltaEvent,
  AssistantReasoningDeltaEvent,
  ServerEvent,
} from "@larness/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { listSessionEvents } from "../../src/modules/agent/events.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import {
  boundedCommandOutput,
  toolFailureIssues,
  toolMessageContent,
} from "../../src/modules/agent/turn/toolResults.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { getProjectById } from "../../src/modules/projects/repository.js";
import { createProject, updateProject } from "../../src/modules/projects/service.js";
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

describe("tool failure detail", () => {
  it("keeps bounded, value-free validation issues", () => {
    const issues = toolFailureIssues({
      issues: [
        { path: "cwd", message: "Expected a relative path inside the authorized root" },
        { path: "args", message: "Too big" },
      ],
    });

    expect(issues).toEqual([
      { path: "cwd", message: "Expected a relative path inside the authorized root" },
      { path: "args", message: "Too big" },
    ]);
    expect(toolFailureIssues({})).toBeUndefined();
    expect(toolFailureIssues(undefined)).toBeUndefined();
    expect(
      toolFailureIssues({ issues: Array.from({ length: 9 }, () => ({ path: "p", message: "m" })) }),
    ).toHaveLength(5);
    expect(
      toolFailureIssues({ issues: [{ path: "x", message: "y".repeat(900) }] })?.[0]?.message,
    ).toHaveLength(300);
  });
});

describe("tool result serialization", () => {
  it("keeps oversized tool results as valid JSON with a truncation page", () => {
    const text = toolMessageContent({
      ok: true,
      summary: "read a.txt",
      data: {
        path: "a.txt",
        version: "v".repeat(64),
        totalLines: 40_000,
        offset: 1,
        nextOffset: 2_001,
        content: "x".repeat(200_000),
      },
    });

    expect(text.length).toBeLessThanOrEqual(16_000);

    const parsed = JSON.parse(text) as {
      path: string;
      content: string;
      nextOffset: number;
      page: { truncated: boolean; omittedChars: number };
    };

    expect(parsed.path).toBe("a.txt");
    expect(parsed.nextOffset).toBe(2_001);
    expect(parsed.page.truncated).toBe(true);
    expect(parsed.page.omittedChars).toBeGreaterThan(0);
    expect(parsed.content).toContain("chars omitted");
  });

  it("lets a single large field use most of the result budget", () => {
    const text = toolMessageContent({
      ok: true,
      summary: "read big.txt",
      data: { path: "big.txt", content: "x".repeat(200_000) },
    });

    expect(text.length).toBeLessThanOrEqual(16_000);

    const parsed = JSON.parse(text) as {
      content: string;
      page: { truncated: boolean; omittedChars: number };
    };

    expect(parsed.content.length).toBeGreaterThanOrEqual(12_000);
    expect(parsed.page.truncated).toBe(true);
    expect(parsed.page.omittedChars).toBeGreaterThan(0);
  });

  it("keeps the tail of a long command output", () => {
    const output = `${"head line\n".repeat(3_000)}FAIL src/a.test.ts\nTests 1 failed\n`;
    const bounded = boundedCommandOutput(output, 12_000);

    expect(bounded.text.length).toBeLessThanOrEqual(12_000);
    expect(bounded.text).toContain("Tests 1 failed");
    expect(bounded.text).toContain("chars omitted");
    expect(bounded.truncated).toBe(true);
  });

  it("keeps error results parseable and preserves the error code", () => {
    const text = toolMessageContent({
      ok: false,
      summary: "command failed",
      errorCode: "COMMAND_FAILED",
      data: { output: "y".repeat(80_000), exitCode: 2 },
    });

    const parsed = JSON.parse(text) as {
      errorCode: string;
      message: string;
      data: { exitCode: number; output: string; page?: { truncated: boolean } };
    };

    expect(parsed.errorCode).toBe("COMMAND_FAILED");
    expect(parsed.message).toBe("command failed");
    expect(parsed.data.exitCode).toBe(2);
    expect(parsed.data.page?.truncated).toBe(true);
  });

  it("leaves small results untouched", () => {
    const text = toolMessageContent({
      ok: true,
      summary: "list",
      data: { files: ["a.ts", "b.ts"] },
    });

    expect(JSON.parse(text)).toEqual({ files: ["a.ts", "b.ts"] });
  });
});

describe("event ordering", () => {
  it("keeps the published event sequence for a multi-step turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        await writeFile(path.join(session.workspacePath, "a.txt"), "old\n");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "sequence" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "c1", name: "list_files", args: {} } },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          {
            chunks: [
              {
                type: "tool-call",
                toolCall: {
                  id: "c2",
                  name: "apply_patch",
                  args: {
                    path: "a.txt",
                    expectedVersion: version,
                    patch: patchFor("old\n", "new\n"),
                  },
                },
              },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
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

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        // turn.created is published by createTurn before the runner is wired.
        expect(published.map((event) => event.type)).toEqual([
          "turn.status",
          "turn.status",
          "tool.requested",
          "tool.started",
          "tool.completed",
          "tool.requested",
          "tool.started",
          "tool.completed",
          "file.changed",
          "model.usage",
          "assistant.message",
          "turn.completed",
        ]);

        const sequences = published.map((event) => event.sequence);
        expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
        expect(new Set(sequences).size).toBe(sequences.length);
      } finally {
        opened.close();
      }
    });
  });
});

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

        // Sorted by name so the tool array stays byte-identical across steps.
        expect(provider.calls[0]?.tools.map((tool) => tool.name)).toEqual([
          "apply_patch",
          "list_files",
          "read_file",
          "search_code",
          "write_file",
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
        const streamed: Array<ServerEvent | AssistantDeltaEvent | AssistantReasoningDeltaEvent> =
          [];
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

  it("persists one model.usage event per model request with its window", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "usage" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
              },
            ],
          },
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake", contextWindow: 1_048_576 }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const usageEvents = listSessionEvents(opened.db, session.id).items.filter(
          (event) => event.type === "model.usage",
        );
        expect(usageEvents).toHaveLength(2);
        expect(usageEvents[0]?.payload).toEqual({
          turnId: turn.turnId,
          model: "fake",
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
          usageSource: "unknown",
          contextWindow: 1_048_576,
        });
        expect(usageEvents[1]?.payload).toMatchObject({ inputTokens: 3, contextWindow: 1_048_576 });
        expect(usageEvents[0]?.sequence).toBeLessThan(usageEvents[1]?.sequence ?? 0);
      } finally {
        opened.close();
      }
    });
  });

  it("reports provider cache hits per request and accumulates them for the turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "cache" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: {
                  inputTokens: 1200,
                  outputTokens: 80,
                  totalTokens: 1280,
                  cacheReadTokens: 900,
                  noCacheTokens: 300,
                },
              },
            ],
          },
          {
            chunks: [
              { type: "text-delta", text: "done" },
              {
                type: "finish",
                finishReason: "stop",
                usage: {
                  inputTokens: 2000,
                  outputTokens: 40,
                  totalTokens: 2040,
                  cacheReadTokens: 1800,
                  noCacheTokens: 200,
                },
              },
            ],
          },
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const usageEvents = listSessionEvents(opened.db, session.id).items.filter(
          (event) => event.type === "model.usage",
        );
        expect(usageEvents[0]?.payload).toMatchObject({
          cacheReadTokens: 900,
          noCacheTokens: 300,
          usageSource: "provider",
        });
        expect(usageEvents[1]?.payload).toMatchObject({
          cacheReadTokens: 1800,
          noCacheTokens: 200,
        });

        const row = opened.sqlite
          .prepare("SELECT usage_json FROM turns WHERE id = ?")
          .get(turn.turnId) as { usage_json: string };
        expect(JSON.parse(row.usage_json)).toMatchObject({
          inputTokens: 3200,
          outputTokens: 120,
          cacheReadTokens: 2700,
          noCacheTokens: 500,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("marks turn cache usage unknown when one step omits it", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "mixed" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: {
                  inputTokens: 1200,
                  outputTokens: 80,
                  totalTokens: 1280,
                  cacheReadTokens: 900,
                  noCacheTokens: 300,
                },
              },
            ],
          },
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const row = opened.sqlite
          .prepare("SELECT usage_json FROM turns WHERE id = ?")
          .get(turn.turnId) as { usage_json: string };
        const usage = JSON.parse(row.usage_json) as Record<string, unknown>;
        expect(usage.inputTokens).toBe(1203);
        expect(usage.cacheReadTokens).toBeUndefined();
        expect(usage.noCacheTokens).toBeUndefined();
      } finally {
        opened.close();
      }
    });
  });

  it("stops at the turn deadline instead of waiting for the provider", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "slow" });
        const provider = createFakeProvider([
          {
            delayMs: 30_000,
            chunks: [
              { type: "text-delta", text: "late" },
              { type: "finish", finishReason: "stop" },
            ],
          },
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxDurationMs: 60 },
        });

        const startedAt = Date.now();
        const result = await runner.run(turn.turnId);

        expect(Date.now() - startedAt).toBeLessThan(2_000);
        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBe("duration");

        const completed = listSessionEvents(opened.db, session.id).items.find(
          (event) => event.type === "turn.completed",
        );
        expect(completed?.payload).toMatchObject({
          turnId: turn.turnId,
          status: "COMPLETED",
          budgetExhausted: true,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("bounds each provider request by the remaining turn budget", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "bounds" });
        const provider = createFakeProvider([textStep("ok")]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxDurationMs: 5_000 },
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const call = provider.calls[0];
        // No cap by default: a fixed limit truncates thinking models before
        // they emit an answer (reasoning tokens share the output budget).
        expect(call?.maxOutputTokens).toBeUndefined();
        expect(call?.maxRetries).toBe(1);
        expect(call?.timeoutMs).toBeGreaterThan(0);
        expect(call?.timeoutMs).toBeLessThanOrEqual(5_000);
      } finally {
        opened.close();
      }
    });
  });

  it("records a normal terminal reason for a completed turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "normal" });
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: createFakeProvider([textStep("ok")]), model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const row = opened.sqlite
          .prepare("SELECT status, terminal_reason FROM turns WHERE id = ?")
          .get(turn.turnId) as { status: string; terminal_reason: string | null };
        expect(row.status).toBe("COMPLETED");
        expect(row.terminal_reason).toBe("normal");
      } finally {
        opened.close();
      }
    });
  });

  it("marks a length-limited answer as output_truncated instead of plain completion", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "truncated" });
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({
            adapter: createFakeProvider([
              {
                chunks: [
                  { type: "text-delta", text: "partial" },
                  { type: "finish", finishReason: "length" },
                ],
              },
            ]),
            model: "fake",
          }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const row = opened.sqlite
          .prepare("SELECT terminal_reason FROM turns WHERE id = ?")
          .get(turn.turnId) as { terminal_reason: string | null };
        expect(row.terminal_reason).toBe("output_truncated");

        const completed = listSessionEvents(opened.db, session.id).items.find(
          (event) => event.type === "turn.completed",
        );
        expect(completed?.payload).toMatchObject({ terminalReason: "output_truncated" });
      } finally {
        opened.close();
      }
    });
  });

  it("records provider failures and budget stops with their own terminal reason", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const failedTurn = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "provider fails",
        });
        const failing = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({
            adapter: createFakeProvider([
              {
                chunks: [
                  {
                    type: "error",
                    error: new ProviderError("PROVIDER_CONTEXT_LIMIT", "context limit exceeded"),
                  },
                ],
              },
            ]),
            model: "fake",
          }),
        });

        expect((await failing.run(failedTurn.turnId)).status).toBe("FAILED");

        const failedRow = opened.sqlite
          .prepare("SELECT terminal_reason FROM turns WHERE id = ?")
          .get(failedTurn.turnId) as { terminal_reason: string | null };
        expect(failedRow.terminal_reason).toBe("provider_error");

        const budgetTurn = createTurn(sessionOptions, { sessionId: session.id, text: "budget" });
        const slow = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({
            adapter: createFakeProvider([
              { delayMs: 30_000, chunks: [{ type: "finish", finishReason: "stop" }] },
            ]),
            model: "fake",
          }),
          budget: { maxDurationMs: 50 },
        });

        expect((await slow.run(budgetTurn.turnId)).status).toBe("COMPLETED");

        const budgetRow = opened.sqlite
          .prepare("SELECT terminal_reason FROM turns WHERE id = ?")
          .get(budgetTurn.turnId) as { terminal_reason: string | null };
        expect(budgetRow.terminal_reason).toBe("budget");
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the request prefix identical across steps and reads observations once", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "prefix" });
        let pm2Calls = 0;
        const pm2 = {
          available: true,
          nodeExecutable: "/usr/bin/node",
          entry: "/usr/lib/pm2/bin/pm2",
          version: "7.1.2",
          home: path.join(dir, "pm2"),
          namespace: "larness" as const,
          serviceNamePattern: "larness:<projectId>:<serviceKey>" as const,
          project: null,
          services: [],
        };
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          pm2Context: async () => {
            pm2Calls += 1;
            return pm2;
          },
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        expect(pm2Calls).toBe(1);

        const first = provider.calls[0];
        const second = provider.calls[1];
        expect(first).toBeDefined();
        expect(second).toBeDefined();
        if (first === undefined || second === undefined) return;

        // Strict superset: the previous request is a byte-identical prefix.
        expect(second.messages.slice(0, first.messages.length)).toEqual(first.messages);
        expect(second.messages[0]).toEqual(first.messages[0]);
        expect(second.tools).toEqual(first.tools);
        expect(second.messages[0]?.role).toBe("system");
        if (second.messages[0]?.role === "system") {
          expect(second.messages[0].content).toContain("Larness prompt version:");
          expect(second.messages[0].content).toContain("snapshot at Turn start");
        }
      } finally {
        opened.close();
      }
    });
  });

  it("refreshes observations through an L0 tool instead of rewriting the prefix", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "refresh" });
        const registry = createFileToolRegistry();
        registry.register(createObservationTool());
        const provider = createFakeProvider([
          {
            chunks: [
              {
                type: "tool-call",
                toolCall: { id: "call_refresh", name: "refresh_observations", args: {} },
              },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry,
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const result = provider.calls[1]?.messages.at(-1);
        expect(result?.role).toBe("tool");
        if (result?.role !== "tool") return;

        const parsed = JSON.parse(result.content) as {
          observedAt: number;
          preview: unknown[];
          terminals: unknown[];
          pm2: unknown;
        };
        expect(typeof parsed.observedAt).toBe("number");
        expect(Array.isArray(parsed.preview)).toBe(true);
        expect(Array.isArray(parsed.terminals)).toBe(true);
        expect(parsed.pm2).toBeNull();
        expect(result.isError).toBe(false);
      } finally {
        opened.close();
      }
    });
  });

  it("stops before sending a request that would exceed the context window", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "window" });
        const provider = createFakeProvider([textStep("too late")]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          // Far smaller than the fixed system prompt, so the pre-check must
          // refuse to send at all instead of letting the provider reject it.
          resolveProvider: () => ({ adapter: provider, model: "fake", contextWindow: 500 }),
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBe("context");
        expect(provider.calls).toHaveLength(0);

        const row = opened.sqlite
          .prepare("SELECT terminal_reason FROM turns WHERE id = ?")
          .get(turn.turnId) as { terminal_reason: string | null };
        expect(row.terminal_reason).toBe("budget");
      } finally {
        opened.close();
      }
    });
  });

  it("compacts history into a checkpoint when the turn approaches the window", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const small = path.join(session.workspacePath, "a.txt");
        await writeFile(small, "old\n");
        // Sized against the current tool-result budget so the read crosses the
        // soft watermark without jumping past the hard one.
        await writeFile(path.join(session.workspacePath, "big.txt"), "x".repeat(4_000), "utf8");
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "compact me" });
        const provider = createFakeProvider([
          {
            chunks: [
              {
                type: "tool-call",
                toolCall: {
                  id: "call_patch",
                  name: "apply_patch",
                  args: {
                    path: "a.txt",
                    expectedVersion: version,
                    patch: patchFor("old\n", "new\n"),
                  },
                },
              },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          {
            chunks: [
              {
                type: "tool-call",
                toolCall: { id: "call_read", name: "read_file", args: { path: "big.txt" } },
              },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          textStep("continued"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake", contextWindow: 3_800 }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const events = listSessionEvents(opened.db, session.id).items;
        const checkpoint = events.find((event) => event.type === "context.checkpoint");
        expect(checkpoint?.payload).toMatchObject({ scope: "turn", reason: "soft_watermark" });

        expect(provider.calls).toHaveLength(3);
        const last = provider.calls[2];
        expect(last?.messages).toHaveLength(2);
        const [, compacted] = last?.messages ?? [];
        expect(compacted?.role).toBe("user");
        if (compacted?.role === "user") {
          expect(compacted.content).toContain("Work state checkpoint");
          expect(compacted.content).toContain("a.txt");
        }

        const stored = opened.sqlite
          .prepare(
            "SELECT scope, reason, tokens_before, tokens_after FROM session_context_summaries WHERE session_id = ? AND scope = 'turn'",
          )
          .all(session.id) as {
          scope: string;
          reason: string;
          tokens_before: number;
          tokens_after: number;
        }[];
        expect(stored).toHaveLength(1);
        expect(stored[0]?.scope).toBe("turn");
        expect(stored[0]?.tokens_after).toBeLessThan(stored[0]?.tokens_before ?? 0);
      } finally {
        opened.close();
      }
    });
  });

  it("intervenes after the same call fails three times without blocking it", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "repeat" });
        const missing = {
          id: "call_missing",
          name: "read_file",
          args: { path: "missing.txt" },
        };
        const provider = createFakeProvider([
          toolStep(missing),
          toolStep({ ...missing, id: "call_missing_2" }),
          toolStep({ ...missing, id: "call_missing_3" }),
          textStep("blocked"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        // All three attempts still executed; the intervention only adds a fact.
        expect(provider.calls).toHaveLength(4);

        const afterThird = provider.calls[3]?.messages ?? [];
        const nudge = afterThird.find(
          (message) =>
            message.role === "user" &&
            typeof message.content === "string" &&
            message.content.includes("failed 3 times in a row"),
        );
        expect(nudge).toBeDefined();

        const failures = listSessionEvents(opened.db, session.id).items.filter(
          (event) => event.type === "tool.failed",
        );
        expect(failures).toHaveLength(3);
        expect(failures[2]?.payload).toMatchObject({ repeatCount: 3 });
      } finally {
        opened.close();
      }
    });
  });

  it("stops on the token cap when one is configured", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "spend" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1_000 },
              },
            ],
          },
          textStep("never reached"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxTotalTokens: 500 },
        });

        const capped = await runner.run(turn.turnId);
        expect(capped.status).toBe("COMPLETED");
        expect(capped.budgetCause).toBe("tokens");
        expect(provider.calls).toHaveLength(1);

        const row = opened.sqlite
          .prepare("SELECT terminal_reason FROM turns WHERE id = ?")
          .get(turn.turnId) as { terminal_reason: string | null };
        expect(row.terminal_reason).toBe("budget");
      } finally {
        opened.close();
      }
    });
  });

  it("forwards an explicitly configured output cap", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "cap" });
        const provider = createFakeProvider([textStep("ok")]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxOutputTokens: 4_096 },
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        expect(provider.calls[0]?.maxOutputTokens).toBe(4_096);
      } finally {
        opened.close();
      }
    });
  });

  it("probes Git once per turn and heals the stored flag after git init", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "repo");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const registry = createFileToolRegistry();
        const first = createFakeProvider([textStep("ok")]);
        const firstRunner = new TurnRunner({
          db: opened.db,
          registry,
          resolveProvider: () => ({ adapter: first, model: "fake" }),
        });

        const firstTurn = createTurn(sessionOptions, { sessionId: session.id, text: "before" });
        expect((await firstRunner.run(firstTurn.turnId)).status).toBe("COMPLETED");
        const firstSystem = first.calls[0]?.messages[0];
        expect(firstSystem?.role === "system" && firstSystem.content).toContain(
          "no Git repository was detected",
        );

        execFileSync("git", ["init", "-q", root]);
        const second = createFakeProvider([textStep("ok")]);
        const secondRunner = new TurnRunner({
          db: opened.db,
          registry,
          resolveProvider: () => ({ adapter: second, model: "fake" }),
        });
        const secondTurn = createTurn(sessionOptions, { sessionId: session.id, text: "after" });
        expect((await secondRunner.run(secondTurn.turnId)).status).toBe("COMPLETED");
        const secondSystem = second.calls[0]?.messages[0];
        expect(secondSystem?.role === "system" && secondSystem.content).toContain(
          "this project is a Git repository",
        );

        // The stored flag self-heals so the sidebar stops claiming "no git".
        expect(getProjectById(opened.db, project.id)?.gitDetected).toBe(true);
      } finally {
        opened.close();
      }
    });
  });

  it("asks the model to wrap up before the step budget runs out", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "long task" });
        // Six tool steps then a text answer: maxSteps 8 puts the wrap-up at step 4.
        const script = Array.from({ length: 6 }, (_, index) => ({
          chunks: [
            {
              type: "tool-call" as const,
              toolCall: { id: `call_${index}`, name: "list_files", args: {} },
            },
            { type: "finish" as const, finishReason: "tool-calls" as const },
          ],
        }));
        const provider = createFakeProvider([...script, textStep("done")]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxSteps: 8 },
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const isWrapUp = (message: { role: string; content: string }) =>
          message.role === "user" && message.content.includes("near its budget");

        // Injected once, then carried along like any other message.
        const lastCall = provider.calls.at(-1);
        const hints = lastCall?.messages.filter((message) => isWrapUp(message)) ?? [];
        expect(hints).toHaveLength(1);

        // The hint is appended at the tail so the request prefix stays intact.
        const hinted = provider.calls.find((call) => {
          const tail = call.messages.at(-1);
          return tail !== undefined && isWrapUp(tail);
        });
        expect(hinted?.messages.at(-1)?.content).toContain("Do not start new work.");
      } finally {
        opened.close();
      }
    });
  });

  it("records a created file for write_file", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "new file" });
        const provider = createFakeProvider([
          toolStep({
            id: "call_write",
            name: "write_file",
            args: { path: "src/hello.txt", content: "hello\n" },
          }),
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const changed = listSessionEvents(opened.db, session.id).items.find(
          (event) => event.type === "file.changed",
        );
        expect(changed?.payload).toMatchObject({
          path: "src/hello.txt",
          changeType: "created",
        });
        expect(await readFile(path.join(session.workspacePath, "src/hello.txt"), "utf8")).toBe(
          "hello\n",
        );

        const completed = listSessionEvents(opened.db, session.id).items.find(
          (event) => event.type === "tool.completed",
        );
        expect(
          (completed?.payload as { resourceTarget?: unknown } | undefined)?.resourceTarget,
        ).toMatchObject({
          kind: "file",
          path: "src/hello.txt",
        });
      } finally {
        opened.close();
      }
    });
  });

  it("keeps reasoning in memory for the tool loop and never persists it", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "think" });
        const reasoning = "private-chain-of-thought-marker";
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "reasoning-delta", text: reasoning },
              { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          textStep("done"),
        ]);
        const published: ServerEvent[] = [];
        const streamed: Array<ServerEvent | AssistantDeltaEvent | AssistantReasoningDeltaEvent> =
          [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          publish: (event) => {
            streamed.push(event);
            if ("sequence" in event) published.push(event);
          },
        });

        const result = await runner.run(turn.turnId);
        expect(result.status).toBe("COMPLETED");
        expect(provider.calls).toHaveLength(2);

        const reasoningEvent = streamed.find(
          (event) => "kind" in event && event.kind === "assistant.reasoning.delta",
        );
        expect(reasoningEvent).toMatchObject({ turnId: turn.turnId, text: reasoning });
        expect(reasoningEvent !== undefined && "sequence" in reasoningEvent).toBe(false);

        const assistant = provider.calls[1]?.messages.find(
          (message) => message.role === "assistant" && message.toolCalls !== undefined,
        );
        expect(assistant).toMatchObject({ role: "assistant", reasoning });

        const persisted = JSON.stringify([
          published,
          listSessionEvents(opened.db, session.id).items,
          opened.sqlite.prepare("SELECT * FROM turns WHERE id = ?").get(turn.turnId),
        ]);
        expect(persisted).not.toContain(reasoning);
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

  it("treats a provider abort as a timeout failure instead of a user cancel", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "timeout" });
        const provider = createFakeProvider([
          {
            chunks: [
              {
                type: "error",
                error: new ProviderError("PROVIDER_ABORTED", "provider request aborted"),
              },
            ],
          },
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
        expect(result).toMatchObject({
          status: "FAILED",
          errorCode: "PROVIDER_UNAVAILABLE",
        });
        expect(published.map((event) => event.type)).toContain("turn.failed");
        expect(published.map((event) => event.type)).not.toContain("turn.cancelled");
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

it("marks earlier identical failures as superseded when the call finally succeeds", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      let attempts = 0;
      const flaky = defineTool({
        name: "flaky_check",
        description: "test-only tool",
        riskLevel: "L0",
        schema: z.object({ target: z.string() }).strict(),
        async handler() {
          attempts += 1;
          return attempts === 1
            ? { ok: false, errorCode: "TOOL_ERROR", summary: "temporary failure" }
            : { ok: true, summary: "ok now" };
        },
      });
      const registry = createFileToolRegistry();
      registry.register(flaky);
      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "retry" });
      const provider = createFakeProvider([
        toolStep({ id: "call_first", name: "flaky_check", args: { target: "x" } }),
        toolStep({ id: "call_second", name: "flaky_check", args: { target: "x" } }),
        textStep("done"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const events = listSessionEvents(opened.db, session.id).items;
      expect(events.filter((event) => event.type === "tool.failed")).toHaveLength(1);
      expect(events.find((event) => event.type === "tool.completed")?.payload).toMatchObject({
        supersedes: ["call_first"],
      });
    } finally {
      opened.close();
    }
  });
});

it("does not supersede a failure when the retry uses different arguments", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      let attempts = 0;
      const flaky = defineTool({
        name: "flaky_check",
        description: "test-only tool",
        riskLevel: "L0",
        schema: z.object({ target: z.string() }).strict(),
        async handler() {
          attempts += 1;
          return attempts === 1
            ? { ok: false, errorCode: "TOOL_ERROR", summary: "temporary failure" }
            : { ok: true, summary: "ok now" };
        },
      });
      const registry = createFileToolRegistry();
      registry.register(flaky);
      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "retry" });
      const provider = createFakeProvider([
        toolStep({ id: "call_first", name: "flaky_check", args: { target: "x" } }),
        toolStep({ id: "call_second", name: "flaky_check", args: { target: "y" } }),
        textStep("done"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const events = listSessionEvents(opened.db, session.id).items;
      expect(events.find((event) => event.type === "tool.completed")?.payload).not.toHaveProperty(
        "supersedes",
      );
    } finally {
      opened.close();
    }
  });
});

it("honors the project ignore list in search_code and list_files", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      const root = path.join(dir, "repo");
      await mkdir(path.join(root, "dist"), { recursive: true });
      await writeFile(path.join(root, "dist", "bundle.js"), "needle\n");
      await writeFile(path.join(root, "src.ts"), "needle\n");
      const project = await createProject(
        { db: opened.db, detectGit: async () => false },
        { rootPath: root },
      );
      updateProject({ db: opened.db }, { id: project.id, settings: { ignore: ["dist"] } });

      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, { projectId: project.id });
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "find needle" });
      const provider = createFakeProvider([
        toolStep({ id: "call_search", name: "search_code", args: { query: "needle" } }),
        toolStep({ id: "call_list", name: "list_files", args: { path: "." } }),
        textStep("done"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry: createFileToolRegistry(),
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const completed = listSessionEvents(opened.db, session.id).items.filter(
        (event) => event.type === "tool.completed",
      );
      const summaries = completed.map(
        (event) => (event.payload as { resultSummary?: string }).resultSummary ?? "",
      );
      expect(summaries).toContain("1 matches in 1 files");
      expect(summaries).toContain("1 entries");
    } finally {
      opened.close();
    }
  });
});

it("reports deliverables and process files when the turn ends", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "write files" });
      const provider = createFakeProvider([
        toolStep({
          id: "call_report",
          name: "write_file",
          args: { path: "docs/report.md", content: "# report\n" },
        }),
        toolStep({
          id: "call_probe",
          name: "write_file",
          args: { path: "tmp/probe.mjs", content: "console.log(1)\n" },
        }),
        textStep("done"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry: createFileToolRegistry(),
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const terminal = listSessionEvents(opened.db, session.id).items.find(
        (event) => event.type === "turn.completed",
      );
      const fileResults = (terminal?.payload as { fileResults?: unknown } | undefined)?.fileResults;
      expect(fileResults).toEqual([
        expect.objectContaining({
          path: "docs/report.md",
          changeType: "created",
          existed: true,
          category: "deliverable",
        }),
        expect.objectContaining({
          path: "tmp/probe.mjs",
          changeType: "created",
          existed: true,
          category: "process",
        }),
      ]);
      for (const result of fileResults as Array<{ version: string }>) {
        expect(result.version).toHaveLength(64);
      }
    } finally {
      opened.close();
    }
  });
});

it("marks a file deleted before the turn ended as process", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "cleanup" });
      const registry = createFileToolRegistry();
      registry.register(
        defineTool({
          name: "remove_file",
          description: "test-only remover",
          riskLevel: "L0",
          schema: z.object({ filePath: z.string() }).strict(),
          async handler(args) {
            await rm(path.join(session.workspacePath, args.filePath));
            return { ok: true, summary: `removed ${args.filePath}` };
          },
        }),
      );
      const provider = createFakeProvider([
        toolStep({
          id: "call_create",
          name: "write_file",
          args: { path: "tmp/probe.mjs", content: "console.log(1)\n" },
        }),
        toolStep({
          id: "call_remove",
          name: "remove_file",
          args: { filePath: "tmp/probe.mjs" },
        }),
        textStep("cleaned up"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const terminal = listSessionEvents(opened.db, session.id).items.find(
        (event) => event.type === "turn.completed",
      );
      expect((terminal?.payload as { fileResults?: unknown } | undefined)?.fileResults).toEqual([
        expect.objectContaining({
          path: "tmp/probe.mjs",
          existed: false,
          category: "process",
        }),
      ]);
    } finally {
      opened.close();
    }
  });
});

it("classifies project-ignored files as process", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      const root = path.join(dir, "repo");
      await mkdir(root, { recursive: true });
      const project = await createProject(
        { db: opened.db, detectGit: async () => false },
        { rootPath: root },
      );
      updateProject({ db: opened.db }, { id: project.id, settings: { ignore: ["generated"] } });

      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, { projectId: project.id });
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "generate" });
      const provider = createFakeProvider([
        toolStep({
          id: "call_generated",
          name: "write_file",
          args: { path: "generated/out.ts", content: "export {}\n" },
        }),
        textStep("done"),
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry: createFileToolRegistry(),
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

      const terminal = listSessionEvents(opened.db, session.id).items.find(
        (event) => event.type === "turn.completed",
      );
      expect((terminal?.payload as { fileResults?: unknown } | undefined)?.fileResults).toEqual([
        expect.objectContaining({
          path: "generated/out.ts",
          existed: true,
          category: "process",
        }),
      ]);
    } finally {
      opened.close();
    }
  });
});

it("reports produced files on a failed turn", async () => {
  await withTempDir(async (dir) => {
    const opened = await openWorkspace(dir);

    try {
      const sessionOptions = { db: opened.db, dataDir: dir };
      const session = await createSession(sessionOptions, {});
      const turn = createTurn(sessionOptions, { sessionId: session.id, text: "fail later" });
      const provider = createFakeProvider([
        toolStep({
          id: "call_report",
          name: "write_file",
          args: { path: "docs/report.md", content: "# report\n" },
        }),
        {
          chunks: [
            {
              type: "error",
              error: new ProviderError("PROVIDER_CONTEXT_LIMIT", "context limit exceeded"),
            },
          ],
        },
      ]);
      const runner = new TurnRunner({
        db: opened.db,
        registry: createFileToolRegistry(),
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });

      expect((await runner.run(turn.turnId)).status).toBe("FAILED");

      const terminal = listSessionEvents(opened.db, session.id).items.find(
        (event) => event.type === "turn.failed",
      );
      expect((terminal?.payload as { fileResults?: unknown } | undefined)?.fileResults).toEqual([
        expect.objectContaining({
          path: "docs/report.md",
          existed: true,
          category: "deliverable",
        }),
      ]);
    } finally {
      opened.close();
    }
  });
});
