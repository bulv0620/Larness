import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  type ProviderChunk,
  ProviderError,
} from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  sanitizeGeneratedTitle,
  summarizeSessionTitle,
  summarizeTitle,
  type TitleSummaryFailure,
} from "../../src/modules/agent/titleSummarizer.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { getSessionById } from "../../src/modules/sessions/repository.js";
import { createSession, updateSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

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

function errorStep(): { chunks: ProviderChunk[] } {
  return {
    chunks: [{ type: "error", error: new ProviderError("PROVIDER_UNAVAILABLE", "boom") }],
  };
}
async function openWorkspace(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function sessionTitle(db: Database, sessionId: string): { title: string; titleSource: string } {
  const row = getSessionById(db, sessionId);
  return { title: row?.title ?? "", titleSource: row?.titleSource ?? "" };
}

function titleRunner(db: Database, provider: ReturnType<typeof createFakeProvider>) {
  return new TurnRunner({
    db,
    registry: createFileToolRegistry(),
    resolveProvider: () => ({ adapter: provider, model: "fake" }),
    providerRetryDelayMs: 0,
    titleSummarizer: ({ session, turn }) =>
      summarizeSessionTitle({
        db,
        sessionId: session.id,
        turnId: turn.id,
        provider: { adapter: provider, model: "fake" },
      }).then(() => undefined),
  });
}

describe("sanitizeGeneratedTitle", () => {
  it("strips wrappers models add around the title", () => {
    expect(sanitizeGeneratedTitle("“修复登录超时”")).toBe("修复登录超时");
    expect(sanitizeGeneratedTitle('"fix login timeout".')).toBe("fix login timeout");
    expect(sanitizeGeneratedTitle("## 修复登录超时")).toBe("修复登录超时");
    expect(sanitizeGeneratedTitle("标题：修复登录超时")).toBe("修复登录超时");
    expect(sanitizeGeneratedTitle("  修复  登录超时 \n")).toBe("修复 登录超时");
  });

  it("caps length and rejects empties", () => {
    const capped = sanitizeGeneratedTitle("很".repeat(60));
    expect(capped).not.toBeNull();
    expect(capped).toHaveLength(48);
    expect(capped?.endsWith("…")).toBe(true);
    expect(sanitizeGeneratedTitle("")).toBeNull();
    expect(sanitizeGeneratedTitle("“”")).toBeNull();
  });
});

describe("summarizeTitle", () => {
  it("returns a sanitized title from the model output", async () => {
    const provider = createFakeProvider([textStep("“修复登录超时”")]);
    const title = await summarizeTitle({
      provider: { adapter: provider, model: "fake" },
      userText: "帮我修复登录超时",
      assistantText: "已修复",
      signal: new AbortController().signal,
    });

    expect(title).toBe("修复登录超时");
    expect(provider.calls[0]?.tools).toEqual([]);
    // Reasoning models burn output budget before the title: a 64-token cap
    // finished `length` with reasoning only and produced no title at all.
    expect(provider.calls[0]?.maxOutputTokens).toBeGreaterThanOrEqual(512);
  });

  it("fails closed on provider errors and empty output", async () => {
    const exhausted = createFakeProvider([]);
    expect(
      await summarizeTitle({
        provider: { adapter: exhausted, model: "fake" },
        userText: "x",
        assistantText: "y",
        signal: new AbortController().signal,
      }),
    ).toBeNull();

    const empty = createFakeProvider([textStep("“”")]);
    expect(
      await summarizeTitle({
        provider: { adapter: empty, model: "fake" },
        userText: "x",
        assistantText: "y",
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });

  it("returns no title when the model spends its whole budget on reasoning", async () => {
    // Reproduces deepseek-v4.1-flash at a 64-token cap: reasoning-delta chunks
    // only, finishReason "length", no text-delta - so no title may be written.
    const provider = createFakeProvider([
      {
        chunks: [
          { type: "reasoning-delta", text: "The user wants a short title for" },
          { type: "reasoning-delta", text: " their conversation about titles." },
          {
            type: "finish",
            finishReason: "length",
            usage: { inputTokens: 40, outputTokens: 64, totalTokens: 104 },
          },
        ],
      },
    ]);

    expect(
      await summarizeTitle({
        provider: { adapter: provider, model: "fake" },
        userText: "会话标题怎么生成的",
        assistantText: null,
        signal: new AbortController().signal,
      }),
    ).toBeNull();
  });
});

describe("session title summary (first message sent)", () => {
  it("replaces the derived title with a summary of the question alone", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        expect(sessionTitle(opened.db, session.id).titleSource).toBe("auto");

        const turn = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "帮我修复登录页超时的问题",
        });
        // The title call fires before the turn's first model step.
        const provider = createFakeProvider([
          textStep("“修复登录超时”"),
          textStep("已把超时从 5s 调到 30s 并加了重试"),
        ]);
        const runner = titleRunner(opened.db, provider);

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        await runner.pendingTitleWork();

        const row = sessionTitle(opened.db, session.id);
        expect(row.title).toBe("修复登录超时");
        expect(row.titleSource).toBe("auto");

        const titleCall = provider.calls[0];
        expect(titleCall).toBeDefined();
        expect(JSON.stringify(titleCall?.messages)).toContain("帮我修复登录页超时的问题");
        // The answer does not exist yet when the title prompt is built.
        expect(JSON.stringify(titleCall?.messages)).not.toContain("已把超时从 5s 调到 30s");
      } finally {
        opened.close();
      }
    });
  });

  it("never overwrites a user rename, and spends no model call", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        updateSession(sessionOptions, { id: session.id, title: "手改标题" });
        expect(sessionTitle(opened.db, session.id)).toMatchObject({
          title: "手改标题",
          titleSource: "user",
        });

        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "继续" });
        const provider = createFakeProvider([textStep("好的")]);
        const runner = titleRunner(opened.db, provider);

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        await runner.pendingTitleWork();

        expect(provider.calls).toHaveLength(1);
        expect(sessionTitle(opened.db, session.id).title).toBe("手改标题");
      } finally {
        opened.close();
      }
    });
  });

  it("summarizes only once: a later turn spends no extra call", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "部署服务" });
        const provider = createFakeProvider([
          textStep("“部署服务”"),
          textStep("部署完成"),
          textStep("第二次回答"),
        ]);
        const runner = titleRunner(opened.db, provider);

        await runner.run(first.turnId);
        await runner.pendingTitleWork();
        expect(sessionTitle(opened.db, session.id).title).toBe("部署服务");

        const second = createTurn(sessionOptions, { sessionId: session.id, text: "再看一下" });
        await runner.run(second.turnId);
        await runner.pendingTitleWork();

        expect(provider.calls).toHaveLength(3);
        expect(sessionTitle(opened.db, session.id).title).toBe("部署服务");
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the derived title when the summary call fails", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "修复超时" });
        // The title call consumes the scripted error; the turn still answers.
        const provider = createFakeProvider([errorStep(), textStep("已完成")]);
        const runner = titleRunner(opened.db, provider);

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        await runner.pendingTitleWork();

        expect(sessionTitle(opened.db, session.id).title).toBe("修复超时");
      } finally {
        opened.close();
      }
    });
  });

  it("still titles a first turn whose model call fails", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "修复超时" });
        // The title lands before the turn's only step fails.
        const provider = createFakeProvider([textStep("“修复超时”"), errorStep()]);
        const runner = titleRunner(opened.db, provider);

        expect((await runner.run(turn.turnId)).status).toBe("FAILED");
        await runner.pendingTitleWork();

        expect(sessionTitle(opened.db, session.id).title).toBe("修复超时");
      } finally {
        opened.close();
      }
    });
  });
});

describe("summarizeTitle diagnostics", () => {
  it("asks for no SDK retries and explains why the title call failed", async () => {
    const failures: TitleSummaryFailure[] = [];
    const provider = createFakeProvider([errorStep()]);

    expect(
      await summarizeTitle({
        provider: { adapter: provider, model: "fake" },
        userText: "帮我修复登录超时",
        assistantText: null,
        signal: new AbortController().signal,
        onFailure: (failure) => failures.push(failure),
      }),
    ).toBeNull();

    // The title has its own budget; SDK defaults must not extend it.
    expect(provider.calls[0]?.maxRetries).toBe(0);
    expect(failures).toEqual([
      expect.objectContaining({ reason: "provider_error", code: "PROVIDER_UNAVAILABLE" }),
    ]);
  });

  it("reports empty output when the model only produced reasoning", async () => {
    const failures: TitleSummaryFailure[] = [];
    const provider = createFakeProvider([
      {
        chunks: [
          { type: "reasoning-delta", text: "thinking about a title" },
          { type: "finish", finishReason: "length" },
        ],
      },
    ]);

    expect(
      await summarizeTitle({
        provider: { adapter: provider, model: "fake" },
        userText: "会话标题怎么生成的",
        assistantText: null,
        signal: new AbortController().signal,
        onFailure: (failure) => failures.push(failure),
      }),
    ).toBeNull();
    expect(failures[0]).toMatchObject({
      reason: "empty_text",
      finishReason: "length",
      sawReasoning: true,
    });
  });
});

describe("session title summary diagnostics", () => {
  it("keeps the derived title and records a timed-out summary", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "修复超时" });
        const provider = createFakeProvider([{ chunks: [], delayMs: 50 }, textStep("已完成")]);
        const logs: { fields: Record<string, unknown>; message: string }[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
          titleSummarizer: ({ session: current, turn: currentTurn }) =>
            summarizeSessionTitle({
              db: opened.db,
              sessionId: current.id,
              turnId: currentTurn.id,
              provider: { adapter: provider, model: "fake" },
              timeoutMs: 5,
              logger: { warn: (fields, message) => logs.push({ fields, message }) },
            }).then(() => undefined),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        await runner.pendingTitleWork();

        expect(sessionTitle(opened.db, session.id).title).toBe("修复超时");
        expect(logs).toContainEqual(
          expect.objectContaining({
            message: "title summary produced no usable text",
            fields: expect.objectContaining({
              timedOut: true,
              reason: "provider_error",
              code: "PROVIDER_ABORTED",
            }),
          }),
        );
      } finally {
        opened.close();
      }
    });
  });
});
