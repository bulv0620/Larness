import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { latestContextSummary } from "../../src/modules/agent/contextCompressor.js";
import {
  boundedCheckpointBody,
  checkpointMessage,
  factsAreEmpty,
  MAX_CHECKPOINT_CHARS,
  MAX_PINNED_REQUEST_CHARS,
  pinnedRequestMessage,
  saveTurnCheckpoint,
  TurnFactsBuilder,
} from "../../src/modules/agent/turnCheckpoint.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { withTempDir } from "../helpers.js";

describe("turn facts", () => {
  it("dedupes files, keeps plan gaps and bounds the checkpoint body", () => {
    const facts = new TurnFactsBuilder("修复登录页面的样式问题");

    facts.recordFile("src/a.ts", "v1");
    facts.recordFile("src/a.ts", "v2");
    facts.recordFile("src/b.ts", "v3");
    facts.recordCommand("Command COMPLETED; exit code 0");
    facts.recordToolFailure("COMMAND_FAILED", "exit code 2");
    facts.recordResource({ kind: "preview", serviceId: "svc_1" });
    facts.recordResource({ kind: "terminal", terminalId: "trm_1" });
    facts.recordPlan([
      { id: "s1", title: "定位", status: "done" },
      { id: "s2", title: "修复", status: "running" },
      { id: "s3", title: "验证", status: "pending" },
    ]);

    const snapshot = facts.snapshot();

    expect(snapshot.goal).toContain("修复登录页面");
    expect(snapshot.files).toEqual([
      { path: "src/a.ts", version: "v2" },
      { path: "src/b.ts", version: "v3" },
    ]);
    expect(snapshot.openSteps).toEqual(["s2: 修复 (running)", "s3: 验证 (pending)"]);
    expect(snapshot.resources.sort()).toEqual(["svc_1", "trm_1"]);
    expect(snapshot.failures).toEqual(["COMMAND_FAILED: exit code 2"]);

    const message = checkpointMessage(snapshot, 1_700_000_000_000);
    expect(message.role).toBe("user");
    expect(message.content).toContain("Work state checkpoint");
    expect(message.content).toContain("src/a.ts");
    expect(message.content.length).toBeLessThan(MAX_CHECKPOINT_CHARS + 600);
  });

  it("reports empty until a fact is recorded", () => {
    const facts = new TurnFactsBuilder("task");

    expect(facts.isEmpty()).toBe(true);
    facts.recordCommand("done");
    expect(facts.isEmpty()).toBe(false);
  });

  it("treats a read-only Turn as having facts", () => {
    const facts = new TurnFactsBuilder("audit the payment module");

    facts.recordRead("src/pay.ts", "abc123");

    expect(facts.isEmpty()).toBe(false);
    expect(factsAreEmpty(facts.snapshot())).toBe(false);
    expect(facts.snapshot().reads).toEqual([{ path: "src/pay.ts", version: "abc123" }]);
  });

  it("promotes a written file out of the read list", () => {
    const facts = new TurnFactsBuilder("task");

    facts.recordRead("src/a.ts", "v1");
    facts.recordFile("src/a.ts", "v2");

    expect(facts.snapshot().reads).toEqual([]);
    expect(facts.snapshot().files).toEqual([{ path: "src/a.ts", version: "v2" }]);
  });

  it("keeps the checkpoint valid JSON and never starves trailing sections", () => {
    const facts = new TurnFactsBuilder("refactor");

    for (let index = 0; index < 60; index += 1) {
      facts.recordFile(`src/very/deep/path/number-${index}.ts`, `version-${index}`);
      facts.recordCommand(`Command COMPLETED; exit code 0; ${"detail ".repeat(40)}`);
      facts.recordResource({ kind: "preview", serviceId: `svc_${index}` });
    }

    const body = boundedCheckpointBody(facts.snapshot());
    const parsed = JSON.parse(body) as {
      resources: string[];
      omitted?: Record<string, number>;
    };

    expect(body.length).toBeLessThanOrEqual(MAX_CHECKPOINT_CHARS);
    // `resources` used to be the first field cut by the character slice.
    expect(parsed.resources.length).toBeGreaterThan(0);
    expect(parsed.omitted?.files).toBeGreaterThan(0);
  });

  it("pins the original request instead of leaving only the short goal", () => {
    const requirement = `需求：${"实现分页缓存。".repeat(2_000)}结尾标记`;
    const pinned = pinnedRequestMessage({ text: requirement });

    expect(pinned?.role).toBe("user");
    expect(pinned?.content).toContain("需求：");
    expect(pinned?.content).toContain("chars omitted");
    expect(pinned?.content.length).toBeLessThan(MAX_PINNED_REQUEST_CHARS + 400);
  });

  it("skips an empty request instead of emitting an empty message", () => {
    expect(pinnedRequestMessage({ text: "   " })).toBeNull();
  });

  it("stores turn checkpoints without becoming the cross-turn summary", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const session = await createSession({ db: opened.db, dataDir: dir }, {});
        const sessionId = session.id;

        saveTurnCheckpoint(opened.db, {
          sessionId,
          turnId: "trn_test",
          coveredUpToSeq: 12,
          summary: '{"files":[]}',
          tokensBefore: 9_000,
          tokensAfter: 900,
          degraded: false,
          reason: "soft_watermark",
          now: 5,
        });

        expect(latestContextSummary(opened.db, sessionId)).toBeNull();

        const row = opened.sqlite
          .prepare(
            "SELECT scope, turn_id, reason, tokens_before, tokens_after FROM session_context_summaries WHERE session_id = ?",
          )
          .get(sessionId) as {
          scope: string;
          turn_id: string;
          reason: string;
          tokens_before: number;
          tokens_after: number;
        };

        expect(row).toMatchObject({
          scope: "turn",
          turn_id: "trn_test",
          reason: "soft_watermark",
          tokens_before: 9_000,
          tokens_after: 900,
        });
      } finally {
        opened.close();
      }
    });
  });
});
