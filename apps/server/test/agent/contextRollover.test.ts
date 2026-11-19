import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  defineTool,
  type ProviderChunk,
} from "@larness/agent";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
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
      { type: "finish", finishReason: "stop" },
    ],
  };
}

describe("context rollover", () => {
  it("ends the slice as continued instead of stopping on the context budget", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "long task" });
        const registry = createFileToolRegistry();
        registry.register(
          defineTool({
            name: "big_result",
            description: "test-only large tool result",
            riskLevel: "L0",
            schema: z.object({}).strict(),
            async handler() {
              return { ok: true, summary: "x".repeat(20_000) };
            },
          }),
        );
        const provider = createFakeProvider(
          [
            {
              chunks: [
                {
                  type: "tool-call",
                  toolCall: { id: "call_big", name: "big_result", args: {} },
                },
                { type: "finish", finishReason: "tool-calls" },
              ],
            },
            textStep("must not be requested"),
          ],
          { capabilities: { maxContextTokens: 4_000 } },
        );
        const runner = new TurnRunner({
          db: opened.db,
          registry,
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(result.terminalReason).toBe("continued");
        expect(result.budgetCause).toBeUndefined();
        expect(provider.calls).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });
});
