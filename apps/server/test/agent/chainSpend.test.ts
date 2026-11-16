import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  carriedSpendTokens,
  sliceSpendTokens,
  spentTokensFromJson,
} from "../../src/modules/agent/turn/chain.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { getTurnById, updateTurnRow } from "../../src/modules/sessions/repository.js";
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

describe("spent tokens", () => {
  it("counts input plus output and treats unusable data as zero", () => {
    expect(sliceSpendTokens({ inputTokens: 900, outputTokens: 100 })).toBe(1_000);
    expect(sliceSpendTokens({ inputTokens: 900 })).toBe(900);
    expect(sliceSpendTokens(null)).toBe(0);
    expect(sliceSpendTokens({})).toBe(0);
    expect(spentTokensFromJson(null)).toBe(0);
    expect(spentTokensFromJson("not json")).toBe(0);
    expect(spentTokensFromJson('{"inputTokens":10,"outputTokens":5}')).toBe(15);
  });

  it("sums every slice already in the chain", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        const first = createTurn(options, { sessionId: session.id, text: "slice 1" });
        updateTurnRow(opened.db, first.turnId, {
          status: "COMPLETED",
          terminalReason: "normal",
          usageJson: '{"inputTokens":2000000,"outputTokens":1000000}',
        });
        const second = createTurn(options, { sessionId: session.id, text: "slice 2" });
        updateTurnRow(opened.db, second.turnId, {
          status: "COMPLETED",
          terminalReason: "normal",
          resumedFromTurnId: first.turnId,
          usageJson: '{"inputTokens":1000000,"outputTokens":500000}',
        });
        const third = createTurn(options, { sessionId: session.id, text: "slice 3" });
        updateTurnRow(opened.db, third.turnId, { resumedFromTurnId: second.turnId });

        // A fresh turn inherits nothing; a continuation inherits every slice
        // before it, including slices that have not recorded usage yet.
        expect(carriedSpendTokens(opened.db, null)).toBe(0);
        expect(carriedSpendTokens(opened.db, first.turnId)).toBe(3_000_000);
        expect(carriedSpendTokens(opened.db, second.turnId)).toBe(4_500_000);
        expect(carriedSpendTokens(opened.db, third.turnId)).toBe(4_500_000);
      } finally {
        opened.close();
      }
    });
  });
});

describe("TurnRunner chained spend cap", () => {
  it("records what a slice spent when the cap ends it", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "spend" });
        const provider = createFakeProvider(
          [
            toolStepWithUsage({
              // Input stays small: provider input tokens anchor the context
              // estimate, and a huge value would stop the turn as "context".
              inputTokens: 1_000,
              outputTokens: 4_999_000,
              totalTokens: 5_000_000,
            }),
            textStep("never reached"),
          ],
          { capabilities: { maxContextTokens: 200_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxTotalTokens: 5_000_000 },
        });

        const result = await runner.run(turn.turnId);

        expect(result.budgetCause).toBe("tokens");
        // The chain reads usage_json, so a cap stop has to persist its spend;
        // without this every continuation would inherit zero.
        expect(spentTokensFromJson(getTurnById(opened.db, turn.turnId)?.usageJson ?? null)).toBe(
          5_000_000,
        );
      } finally {
        opened.close();
      }
    });
  });

  it("spends the same cap across a continuation instead of restarting it", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "long task" });
        // The earlier slice already bought 5M of work and settled on the cap.
        updateTurnRow(opened.db, first.turnId, {
          status: "COMPLETED",
          terminalReason: "budget",
          usageJson: '{"inputTokens":4000000,"outputTokens":1000000}',
        });
        const next = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "Work state checkpoint",
        });
        updateTurnRow(opened.db, next.turnId, { resumedFromTurnId: first.turnId });

        const provider = createFakeProvider(
          [
            toolStepWithUsage({
              inputTokens: 0,
              outputTokens: 1_500_000,
              totalTokens: 1_500_000,
            }),
            textStep("done"),
          ],
          { capabilities: { maxContextTokens: 200_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          budget: { maxTotalTokens: 6_000_000 },
        });

        const result = await runner.run(next.turnId);

        // 5M carried plus 1.5M here is past the 6M cap, so the second model
        // call must not happen. A per-slice allowance would have allowed it.
        expect(result.status).toBe("COMPLETED");
        expect(result.budgetCause).toBe("tokens");
        expect(provider.calls).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });
});
