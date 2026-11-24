import path from "node:path";
import { createFakeProvider, createFileToolRegistry, ProviderError } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import {
  COMPRESSION_RATIO,
  compressContext,
  latestContextSummary,
  shouldCompress,
} from "../../src/modules/agent/contextCompressor.js";
import { appendAgentEvent, listSessionEvents } from "../../src/modules/agent/events.js";
import { DEFAULT_BUDGET } from "../../src/modules/agent/turn/budget.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function fixture(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const options = { db: opened.db, dataDir: dir };
  const session = await createSession(options, {});
  const created = createTurn(options, { sessionId: session.id, text: "current task" });
  const turn = getTurnById(opened.db, created.turnId);

  if (turn === null) throw new Error("turn missing");

  for (let index = 0; index < 20; index += 1) {
    appendAgentEvent(opened.db, {
      sessionId: session.id,
      turnId: null,
      type: "user.message",
      payload: { text: `user message ${index} with some detail` },
      now: 1_000 + index * 2,
    });
    appendAgentEvent(opened.db, {
      sessionId: session.id,
      turnId: null,
      type: "assistant.message",
      payload: { text: `assistant reply ${index} with some detail` },
      now: 1_001 + index * 2,
    });
  }

  return { opened, options, session, turn };
}

describe("context compression", () => {
  it("compresses older history and keeps recent messages", async () => {
    await withTempDir(async (dir) => {
      const { opened, session, turn } = await fixture(dir);

      try {
        expect(shouldCompress(700, 1_000)).toBe(true);
        expect(shouldCompress(699, 1_000)).toBe(false);
        // A4 counterexample: the same input was under the old 0.8 threshold,
        // which is why sessions used to be trimmed instead of summarized.
        expect(shouldCompress(750, 1_000)).toBe(true);
        expect(COMPRESSION_RATIO).toBeLessThan(DEFAULT_BUDGET.contextRatio);

        const adapter = createFakeProvider([
          {
            chunks: [
              { type: "text-delta", text: "SUMMARY 目标 / 已完成 / 待办" },
              { type: "finish", finishReason: "stop" },
            ],
          },
        ]);
        const result = await compressContext({
          db: opened.db,
          session,
          turn,
          adapter,
          model: "fake",
          apiKey: "sk-fake",
          contextWindow: 1_000,
          tokensBefore: 800,
        });

        expect(result).toMatchObject({ degraded: false });
        expect(result?.coveredUpToSeq).toBeGreaterThan(0);
        const summary = latestContextSummary(opened.db, session.id);
        expect(summary?.summary).toContain("SUMMARY");
        expect(summary?.tokensAfter).toBeLessThan(800);

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 1_000,
            policy: "standard",
          },
          session,
          turn,
        );
        expect(context.summaryUsed).toBe(true);
        // The summary is per-Turn context, so it travels with the request
        // instead of rewriting the cached system prefix (specs/089 R-2).
        expect(String(context.messages[0]?.content)).not.toContain("SUMMARY");
        const last = context.messages.at(-1);
        expect(last).toMatchObject({ role: "user" });
        expect(String(last?.content)).toContain("SUMMARY");
        expect(String(last?.content)).toContain("current task");
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("falls back to truncation when the summary request fails", async () => {
    await withTempDir(async (dir) => {
      const { opened, session, turn } = await fixture(dir);

      try {
        const adapter = createFakeProvider([
          {
            chunks: [
              {
                type: "error",
                error: new ProviderError("PROVIDER_UNAVAILABLE", "summary failed"),
              },
            ],
          },
        ]);
        const result = await compressContext({
          db: opened.db,
          session,
          turn,
          adapter,
          model: "fake",
          apiKey: "sk-fake",
          contextWindow: 1_000,
          tokensBefore: 800,
        });

        expect(result).toMatchObject({ degraded: true });
        expect(latestContextSummary(opened.db, session.id)).toBeNull();
        expect(
          assembleContext(
            {
              db: opened.db,
              registry: createFileToolRegistry(),
              maxContextTokens: 1_000,
              policy: "standard",
            },
            session,
            turn,
          ).summaryUsed,
        ).toBe(false);
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("does nothing when there is not enough compressible history", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const created = createTurn(options, { sessionId: session.id, text: "short" });
      const turn = getTurnById(opened.db, created.turnId);

      if (turn === null) throw new Error("turn missing");

      try {
        const result = await compressContext({
          db: opened.db,
          session,
          turn,
          adapter: createFakeProvider([]),
          model: "fake",
          contextWindow: 1_000,
          tokensBefore: 800,
        });
        expect(result).toBeNull();
      } finally {
        opened.sqlite.close();
      }
    });
  });
  it("keeps history provider-neutral across model switches", async () => {
    await withTempDir(async (dir) => {
      const { opened, session, turn } = await fixture(dir);

      try {
        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
            policy: "standard",
          },
          session,
          turn,
        );
        const history = context.messages.slice(1, -1);

        expect(history.length).toBeGreaterThan(0);
        expect(
          history.every((message) => message.role === "user" || message.role === "assistant"),
        ).toBe(true);
        expect(JSON.stringify(history)).not.toContain("reasoning");
        expect(JSON.stringify(history)).not.toContain("providerOptions");
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("summarizes an oversized history in chunks and merges the parts", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const created = createTurn(options, { sessionId: session.id, text: "current task" });
      const turn = getTurnById(opened.db, created.turnId);

      if (turn === null) throw new Error("turn missing");

      // Long entries so the transcript cannot fit into one summary prompt.
      for (let index = 0; index < 20; index += 1) {
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: null,
          type: "user.message",
          payload: { text: `user ${index} `.padEnd(400, "x") },
          now: 1_000 + index * 2,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: null,
          type: "assistant.message",
          payload: { text: `assistant ${index} `.padEnd(400, "y") },
          now: 1_001 + index * 2,
        });
      }

      try {
        const adapter = createFakeProvider(
          Array.from({ length: 12 }, () => ({
            chunks: [
              { type: "text-delta" as const, text: "CHUNK-SUMMARY" },
              { type: "finish" as const, finishReason: "stop" as const },
            ],
          })),
        );
        const result = await compressContext({
          db: opened.db,
          session,
          turn,
          adapter,
          model: "fake",
          apiKey: "sk-fake",
          contextWindow: 1_000,
          tokensBefore: 900,
        });

        expect(result).toMatchObject({ degraded: false });
        // More than one chunk plus a merge pass; the single prompt used to fail.
        expect(adapter.calls.length).toBeGreaterThan(2);
        expect(latestContextSummary(opened.db, session.id)?.summary).toContain("CHUNK-SUMMARY");
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("keeps the same history anchor for the turns after a compression", async () => {
    await withTempDir(async (dir) => {
      const { opened, session, turn } = await fixture(dir);
      try {
        const adapter = createFakeProvider([
          {
            chunks: [
              { type: "text-delta", text: "SUMMARY 目标 / 已完成 / 待办" },
              { type: "finish", finishReason: "stop" },
            ],
          },
        ]);
        const result = await compressContext({
          db: opened.db,
          session,
          turn,
          adapter,
          model: "fake",
          apiKey: "sk-fake",
          contextWindow: 128_000,
          tokensBefore: 90_000,
        });
        expect(result).toMatchObject({ degraded: false });

        const assemble = () =>
          assembleContext(
            {
              db: opened.db,
              registry: createFileToolRegistry(),
              maxContextTokens: 128_000,
              policy: "standard",
            },
            session,
            turn,
          );

        const first = assemble();
        expect(first.firstHistorySeq).toBeGreaterThan(0);

        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: null,
          type: "user.message",
          payload: { text: "later user message" },
          now: 9_000,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: null,
          type: "assistant.message",
          payload: { text: "later answer" },
          now: 9_001,
        });

        // A3: appending at the end must not move the anchor.
        expect(assemble().firstHistorySeq).toBe(first.firstHistorySeq);
        expect(assemble().firstHistorySeq).toBe(first.firstHistorySeq);
      } finally {
        opened.sqlite.close();
      }
    });
  });

  it("triggers session compression before trimming on a long Turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});

        for (let index = 0; index < 14; index += 1) {
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: null,
            type: "user.message",
            payload: { text: `history ${index} ${"x".repeat(6_000)}` },
            now: 100 + index * 2,
          });
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            turnId: null,
            type: "assistant.message",
            payload: { text: `reply ${index} ${"y".repeat(6_000)}` },
            now: 101 + index * 2,
          });
        }

        const created = createTurn(options, { sessionId: session.id, text: "current task" });
        const turn = getTurnById(opened.db, created.turnId);
        if (turn === null) throw new Error("turn missing");
        const registry = createFileToolRegistry();
        const assembled = assembleContext(
          { db: opened.db, registry, maxContextTokens: 128_000, policy: "standard" },
          session,
          turn,
        );
        expect(assembled.truncatedHistory).toBe(false);

        // Pick the window that puts this exact request at 75% — above the new
        // threshold and below the assembly budget, i.e. the dead-code case.
        const window = Math.ceil(assembled.estimatedTokens / 0.75);
        expect(assembled.estimatedTokens / window).toBeGreaterThanOrEqual(COMPRESSION_RATIO);
        expect(assembled.estimatedTokens).toBeLessThan(DEFAULT_BUDGET.contextRatio * window);

        const provider = createFakeProvider(
          Array.from({ length: 6 }, (_, index) => ({
            chunks: [
              { type: "text-delta" as const, text: `SUMMARY ${index} 目标 / 已完成` },
              { type: "finish" as const, finishReason: "stop" as const },
            ],
          })),
          { capabilities: { maxContextTokens: window } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry,
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.id)).status).toBe("COMPLETED");

        const events = listSessionEvents(opened.db, session.id).items;
        expect(events.find((event) => event.type === "context.compressed")?.payload).toMatchObject({
          degraded: false,
        });
        expect(latestContextSummary(opened.db, session.id)).not.toBeNull();
      } finally {
        opened.sqlite.close();
      }
    });
  });
});
