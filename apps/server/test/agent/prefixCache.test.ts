import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { PROMPT_VERSION } from "../../src/modules/agent/contextAssembler.js";
import { appendAgentEvent, listSessionEvents } from "../../src/modules/agent/events.js";
import {
  classifyPrefixBreak,
  PREFIX_BREAK_REASONS,
  PROVIDER_EVICTION_MIN_TOKENS,
  type PrefixSnapshot,
  prefixSnapshot,
  readPreviousPrefix,
  shortHash,
  toolsetHash,
} from "../../src/modules/agent/turn/prefixCache.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

function snapshot(overrides: Partial<Parameters<typeof prefixSnapshot>[0]> = {}): PrefixSnapshot {
  return prefixSnapshot({
    promptVersion: PROMPT_VERSION,
    systemCore: "stable core",
    instructions: "agents rules",
    tools: [],
    model: "fake",
    firstHistorySeq: 1,
    prefixTokens: 120,
    ...overrides,
  });
}

function textStep(
  text: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheReadTokens: number;
    noCacheTokens: number;
  },
): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop", usage },
    ],
  };
}

describe("prefix cache attribution", () => {
  it("hashes to 12 hex characters and separates segments", () => {
    expect(shortHash("stable core")).toMatch(/^[a-f0-9]{12}$/);
    expect(shortHash("stable core")).toBe(shortHash("stable core"));
    expect(shortHash("stable core")).not.toBe(shortHash("stable core "));

    const base = snapshot();
    expect(base.systemHash).toBe(shortHash("stable core"));
    expect(base.instructionsHash).toBe(shortHash("agents rules"));
    expect(toolsetHash([])).toBe(base.toolsetHash);
    expect(
      toolsetHash([
        {
          name: "read_file",
          description: "read",
          parameters: { type: "object", properties: {} },
        },
      ]),
    ).not.toBe(base.toolsetHash);
  });

  it("reports cold when there is no previous request", () => {
    expect(classifyPrefixBreak({ previous: null, current: snapshot() })).toEqual({
      reason: "cold",
      at: "system",
    });
  });

  it("reports a clean prefix when nothing moved", () => {
    expect(classifyPrefixBreak({ previous: snapshot(), current: snapshot() })).toEqual({
      reason: "none",
      at: null,
    });
  });

  it("attributes a model switch before any hash comparison", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ model: "other" }),
        current: snapshot({ promptVersion: "999-1" }),
      }),
    ).toEqual({ reason: "model_switch", at: "model" });
  });

  it("attributes a prompt version bump", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ promptVersion: "088-1" }),
        current: snapshot(),
      }),
    ).toEqual({ reason: "prompt_version", at: "system" });
  });

  it("attributes a system core change without a version bump as unknown", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ systemCore: "older core" }),
        current: snapshot(),
      }),
    ).toEqual({ reason: "unknown", at: "system" });
  });

  it("attributes an instructions edit", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ instructions: "older rules" }),
        current: snapshot(),
      }),
    ).toEqual({ reason: "instructions", at: "instructions" });
  });

  it("attributes a tool array change", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({
          tools: [{ name: "web_search", description: "web", parameters: {} }],
        }),
        current: snapshot(),
      }),
    ).toEqual({ reason: "tools", at: "tools" });
  });

  it("separates budget trimming from session compaction", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ firstHistorySeq: 4 }),
        current: snapshot({ firstHistorySeq: 9, historyTrimmed: true, compacted: true }),
      }),
    ).toEqual({ reason: "history_drop", at: "history" });

    expect(
      classifyPrefixBreak({
        previous: snapshot({ firstHistorySeq: 4 }),
        current: snapshot({ firstHistorySeq: 9, compacted: true }),
      }),
    ).toEqual({ reason: "compacted", at: "history" });
  });

  it("does not treat the first replay of history as a break", () => {
    // Turn 1 had no history; Turn 2 replays it at the end of the prefix, so the
    // prefix still matches and nothing was dropped.
    expect(
      classifyPrefixBreak({
        previous: snapshot({ firstHistorySeq: null }),
        current: snapshot({ firstHistorySeq: 12 }),
      }),
    ).toEqual({ reason: "none", at: null });
  });

  it("attributes a large cache drop with an unchanged fingerprint to the provider", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot({ cacheReadTokens: 10_000 }),
        current: snapshot({ cacheReadTokens: 3_000 }),
      }),
    ).toEqual({ reason: "provider_eviction", at: "history" });

    expect(
      classifyPrefixBreak({
        previous: snapshot({ cacheReadTokens: 10_000 }),
        current: snapshot({ cacheReadTokens: 10_000 - (PROVIDER_EVICTION_MIN_TOKENS - 1) }),
      }),
    ).toEqual({ reason: "none", at: null });

    expect(
      classifyPrefixBreak({
        previous: snapshot({ cacheReadTokens: 1_000 }),
        current: snapshot({ cacheReadTokens: 1 }),
      }),
    ).toEqual({ reason: "none", at: null });
  });

  it("lets a mid-Turn checkpoint break win over the hash comparison", () => {
    expect(
      classifyPrefixBreak({
        previous: snapshot(),
        current: snapshot(),
        pending: { reason: "history_drop", at: "history" },
      }),
    ).toEqual({ reason: "history_drop", at: "history" });
  });

  it("keeps the documented enum stable", () => {
    expect(PREFIX_BREAK_REASONS).toEqual([
      "none",
      "cold",
      "prompt_version",
      "instructions",
      "tools",
      "history_drop",
      "compacted",
      "model_switch",
      "provider_eviction",
      "unknown",
    ]);
  });
});

describe("previous prefix snapshot", () => {
  it("returns null before any request was recorded", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const session = await createSession({ db: opened.db, dataDir: dir }, {});
        expect(readPreviousPrefix(opened.db, session.id)).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("reads the last recorded request and ignores legacy payloads", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const session = await createSession({ db: opened.db, dataDir: dir }, {});
        const record = snapshot({ firstHistorySeq: 7, cacheReadTokens: 640 });

        appendAgentEvent(opened.db, {
          sessionId: session.id,
          type: "model.usage",
          payload: { ...record },
          now: 1,
        });
        expect(readPreviousPrefix(opened.db, session.id)).toEqual(record);

        appendAgentEvent(opened.db, {
          sessionId: session.id,
          type: "model.usage",
          payload: { model: "fake", inputTokens: 10, usageSource: "unknown" },
          now: 2,
        });
        expect(readPreviousPrefix(opened.db, session.id)).toBeNull();
      } finally {
        opened.close();
      }
    });
  });
});

describe("TurnRunner prefix attribution", () => {
  it("records cold then none across two Turns without leaking content", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        const first = createTurn(options, { sessionId: session.id, text: "first" });
        const usage = {
          inputTokens: 100,
          outputTokens: 10,
          totalTokens: 110,
          cacheReadTokens: 0,
          noCacheTokens: 100,
        };
        const provider = createFakeProvider(
          [textStep("answer one", usage), textStep("answer two", usage)],
          { capabilities: { maxContextTokens: 128_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(first.turnId)).status).toBe("COMPLETED");

        const second = createTurn(options, { sessionId: session.id, text: "second" });
        expect((await runner.run(second.turnId)).status).toBe("COMPLETED");

        const events = listSessionEvents(opened.db, session.id).items;
        const payloads = events
          .filter((event) => event.type === "model.usage")
          .map((event) => event.payload as Record<string, unknown>);

        expect(payloads).toHaveLength(2);
        expect(payloads[0]).toMatchObject({
          promptVersion: PROMPT_VERSION,
          prefixBreak: "cold",
          prefixBreakAt: "system",
        });
        expect(payloads[1]).toMatchObject({
          promptVersion: PROMPT_VERSION,
          prefixBreak: "none",
        });
        expect(payloads[1]).not.toHaveProperty("prefixBreakAt");
        expect(payloads[1]?.systemHash).toBe(payloads[0]?.systemHash);
        expect(payloads[1]?.instructionsHash).toBe(payloads[0]?.instructionsHash);
        expect(payloads[1]?.toolsetHash).toBe(payloads[0]?.toolsetHash);
        expect(payloads[1]?.firstHistorySeq).toEqual(expect.any(Number));
        expect(payloads[1]?.prefixKeptTokens).toEqual(expect.any(Number));

        // A7: enums, counts and short hashes only.
        const serialized = JSON.stringify(payloads[1]);
        expect(serialized).not.toContain("answer one");
        expect(serialized).not.toContain("You are Larness");
        expect(payloads[1]?.systemHash).toMatch(/^[a-f0-9]{12}$/);

        // D4: the turn-level aggregate keeps its existing shape.
        const completed = events.find((event) => event.type === "turn.completed");
        const completedUsage = (
          completed?.payload as { usage?: Record<string, unknown> } | undefined
        )?.usage;
        expect(completedUsage).not.toHaveProperty("prefixBreak");
      } finally {
        opened.close();
      }
    });
  });
});
