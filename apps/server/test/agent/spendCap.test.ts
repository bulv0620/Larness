import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  DEFAULT_BUDGET,
  resolveSpendCap,
  SPEND_CAP_CONTEXTS,
} from "../../src/modules/agent/turn/budget.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function toolStepWithUsage(usage: {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "tool-call", toolCall: { id: "call_list", name: "list_files", args: {} } },
      { type: "finish", finishReason: "tool-calls", usage },
    ],
  };
}

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop" },
    ],
  };
}

describe("resolveSpendCap", () => {
  it("keeps wall clock as a stall guard rather than the real budget", () => {
    // 180 minutes: long verification-heavy Turns were cut mid-work by the old
    // 60-minute clock while the spend cap is what actually bounds a Turn.
    expect(DEFAULT_BUDGET.maxDurationMs).toBe(180 * 60_000);
    expect(DEFAULT_BUDGET.maxSteps).toBe(0);
    expect(DEFAULT_BUDGET.maxToolCalls).toBe(0);
  });

  it("scales the default cap with the reported window", () => {
    expect(SPEND_CAP_CONTEXTS).toBe(30);
    expect(resolveSpendCap(DEFAULT_BUDGET, 128_000)).toBe(3_840_000);
    expect(resolveSpendCap(DEFAULT_BUDGET, 200_000)).toBe(6_000_000);
  });

  it("grows with the window instead of shrinking the step count", () => {
    const small = resolveSpendCap(DEFAULT_BUDGET, 100_000);
    const large = resolveSpendCap(DEFAULT_BUDGET, 1_000_000);

    // A fixed cap would give a 1M window a tenth of the steps of a 100k
    // window; the adaptive cap keeps the step count constant.
    expect(large).toBe(small * 10);
    expect(small / 100_000).toBe(SPEND_CAP_CONTEXTS);
  });

  it("lets an explicit cap win over the adaptive default", () => {
    expect(resolveSpendCap({ maxTotalTokens: 500, spendCapContexts: 30 }, 200_000)).toBe(500);
  });

  it("disables the cap when the window multiple is zero", () => {
    expect(resolveSpendCap({ maxTotalTokens: 0, spendCapContexts: 0 }, 200_000)).toBe(0);
  });

  it("disables the cap when the window is unknown", () => {
    expect(resolveSpendCap({ maxTotalTokens: 0, spendCapContexts: 30 }, 0)).toBe(0);
  });
});

describe("TurnRunner spend cap", () => {
  it("keeps running past the old fixed 2M cap on a large-context model", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "wide window" });
        // 2.5M spent is above the previous fixed 2M cap and below 30 windows of
        // a 200k model (6M), so only the adaptive cap lets step 2 happen.
        const provider = createFakeProvider(
          [
            toolStepWithUsage({
              inputTokens: 0,
              outputTokens: 2_500_000,
              totalTokens: 2_500_000,
            }),
            textStep("done"),
          ],
          { capabilities: { maxContextTokens: 200_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBeUndefined();
        expect(provider.calls).toHaveLength(2);
      } finally {
        opened.close();
      }
    });
  });

  it("honours an explicit absolute cap regardless of the window", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "pinned" });
        const provider = createFakeProvider(
          [
            toolStepWithUsage({ inputTokens: 900, outputTokens: 100, totalTokens: 1_000 }),
            textStep("never reached"),
          ],
          { capabilities: { maxContextTokens: 1_000_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxTotalTokens: 500 },
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBe("tokens");
        expect(provider.calls).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });

  it("treats a zero window multiple as no spend cap", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "uncapped" });
        const provider = createFakeProvider(
          [
            toolStepWithUsage({
              inputTokens: 0,
              outputTokens: 2_500_000,
              totalTokens: 2_500_000,
            }),
            textStep("done"),
          ],
          { capabilities: { maxContextTokens: 200_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { spendCapContexts: 0 },
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBeUndefined();
        expect(provider.calls).toHaveLength(2);
      } finally {
        opened.close();
      }
    });
  });
});
