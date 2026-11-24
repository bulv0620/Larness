import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { getSessionUsage } from "../../src/modules/sessions/usage.js";
import { withTempDir } from "../helpers.js";

describe("session usage", () => {
  it("sums terminal turns and ignores turns still in flight", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        const first = createTurn(options, { sessionId: session.id, text: "one" });
        updateTurnRow(opened.db, first.turnId, {
          status: "COMPLETED",
          usageJson: JSON.stringify({
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            cacheReadTokens: 20,
            noCacheTokens: 80,
          }),
          endedAt: 100,
        });
        const second = createTurn(options, { sessionId: session.id, text: "two" });
        updateTurnRow(opened.db, second.turnId, {
          status: "FAILED",
          usageJson: JSON.stringify({ inputTokens: 200, outputTokens: 25, totalTokens: 225 }),
          endedAt: 200,
        });
        const running = createTurn(options, { sessionId: session.id, text: "three" });
        updateTurnRow(opened.db, running.turnId, {
          status: "RUNNING",
          usageJson: JSON.stringify({ inputTokens: 999, outputTokens: 999, totalTokens: 1998 }),
        });

        expect(getSessionUsage(opened.db, session.id)).toEqual({
          sessionId: session.id,
          inputTokens: 300,
          outputTokens: 75,
          totalTokens: 375,
          cacheReadTokens: null,
          noCacheTokens: null,
          cache: {
            hitRate: null,
            readTokens: 0,
            missTokens: 0,
            knownRequests: 0,
            unknownRequests: 0,
            breaks: [],
          },
          turns: 2,
          missingTurns: 0,
          partial: false,
          updatedAt: 200,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("reports partial sums without zero-filling missing usage", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        const missing = createTurn(options, { sessionId: session.id, text: "missing" });
        updateTurnRow(opened.db, missing.turnId, {
          status: "COMPLETED",
          usageJson: null,
          endedAt: 10,
        });
        const partial = createTurn(options, { sessionId: session.id, text: "partial" });
        updateTurnRow(opened.db, partial.turnId, {
          status: "COMPLETED",
          usageJson: JSON.stringify({ inputTokens: 10 }),
          endedAt: 20,
        });
        const steps = createTurn(options, { sessionId: session.id, text: "steps" });
        updateTurnRow(opened.db, steps.turnId, {
          status: "CANCELLED",
          usageJson: JSON.stringify({
            inputTokens: 5,
            outputTokens: 5,
            totalTokens: 10,
            missingSteps: 1,
          }),
          endedAt: 30,
        });

        expect(getSessionUsage(opened.db, session.id)).toMatchObject({
          inputTokens: 15,
          outputTokens: 5,
          totalTokens: 10,
          turns: 3,
          missingTurns: 3,
          partial: true,
          updatedAt: 30,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("computes cache hit rate only from provider-reported requests", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          type: "model.usage",
          payload: {
            model: "deepseek-chat",
            inputTokens: 1_000,
            cacheReadTokens: 800,
            noCacheTokens: 200,
            usageSource: "provider",
            prefixBreak: "none",
          },
          now: 1,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          type: "model.usage",
          payload: {
            model: "deepseek-chat",
            inputTokens: 600,
            cacheReadTokens: 300,
            usageSource: "provider",
            prefixBreak: "history_drop",
          },
          now: 2,
        });
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          type: "model.usage",
          payload: { model: "deepseek-chat", inputTokens: 500, usageSource: "unknown" },
          now: 3,
        });

        const usage = getSessionUsage(opened.db, session.id);
        expect(usage.cache).toEqual({
          hitRate: 1_100 / 1_600,
          readTokens: 1_100,
          missTokens: 500,
          knownRequests: 2,
          unknownRequests: 1,
          breaks: [
            { reason: "none", requests: 1, readTokens: 800, missTokens: 200 },
            { reason: "history_drop", requests: 1, readTokens: 300, missTokens: 300 },
          ],
        });
        expect(usage.cache.hitRate).toBeCloseTo(0.6875);
      } finally {
        opened.close();
      }
    });
  });

  it("groups cache breaks in enum order and keeps unknown sources out", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});
        const request = (now: number, payload: Record<string, unknown>) =>
          appendAgentEvent(opened.db, {
            sessionId: session.id,
            type: "model.usage",
            payload,
            now,
          });

        request(1, {
          model: "deepseek-chat",
          inputTokens: 1_000,
          cacheReadTokens: 100,
          noCacheTokens: 900,
          usageSource: "provider",
          prefixBreak: "cold",
        });
        request(2, {
          model: "deepseek-chat",
          inputTokens: 1_000,
          cacheReadTokens: 500,
          noCacheTokens: 500,
          usageSource: "provider",
          prefixBreak: "none",
        });
        request(3, {
          model: "deepseek-chat",
          inputTokens: 100,
          cacheReadTokens: 50,
          noCacheTokens: 50,
          usageSource: "provider",
          prefixBreak: "cold",
        });
        // No provider cache fields: not in `breaks` and not in the denominator.
        request(4, {
          model: "deepseek-chat",
          inputTokens: 400,
          usageSource: "unknown",
          prefixBreak: "instructions",
        });
        // Unknown values fall back to the `unknown` bucket.
        request(5, {
          model: "deepseek-chat",
          inputTokens: 100,
          cacheReadTokens: 10,
          noCacheTokens: 90,
          usageSource: "provider",
          prefixBreak: "made-up",
        });

        expect(getSessionUsage(opened.db, session.id).cache).toEqual({
          hitRate: 660 / 2_200,
          readTokens: 660,
          missTokens: 1_540,
          knownRequests: 4,
          unknownRequests: 1,
          breaks: [
            { reason: "none", requests: 1, readTokens: 500, missTokens: 500 },
            { reason: "cold", requests: 2, readTokens: 150, missTokens: 950 },
            { reason: "unknown", requests: 1, readTokens: 10, missTokens: 90 },
          ],
        });
      } finally {
        opened.close();
      }
    });
  });

  it("returns zeros for a session without terminal turns", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const options = { db: opened.db, dataDir: dir };
        const session = await createSession(options, {});

        expect(getSessionUsage(opened.db, session.id)).toEqual({
          sessionId: session.id,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cacheReadTokens: null,
          noCacheTokens: null,
          cache: {
            hitRate: null,
            readTokens: 0,
            missTokens: 0,
            knownRequests: 0,
            unknownRequests: 0,
            breaks: [],
          },
          turns: 0,
          missingTurns: 0,
          partial: false,
          updatedAt: null,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("fails closed for an unknown session", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        expect(() => getSessionUsage(opened.db, "ses_missing")).toThrow(/session not found/);
      } finally {
        opened.close();
      }
    });
  });
});
