import { describe, expect, it } from "vitest";
import {
  aggregateLarness,
  extractSessionId,
  median,
  parseOpenCodeJsonl,
  type SideRun,
  summarizeSide,
} from "../../scripts/agent-benchmark/roundsLib.js";

describe("benchmark rounds helpers", () => {
  it("computes medians for odd, even and empty samples", () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 4, 2, 3])).toBe(2.5);
  });

  it("aggregates all prompts in a Larness result", () => {
    const metrics = aggregateLarness({
      prompts: [
        {
          steps: 2,
          toolCalls: 3,
          toolFailures: 0,
          inputTokens: 100,
          outputTokens: 10,
          cacheReadTokens: 40,
          durationMs: 1_000,
        },
        {
          steps: 1,
          toolCalls: 2,
          toolFailures: 1,
          inputTokens: 50,
          outputTokens: 5,
          cacheReadTokens: 20,
          durationMs: 500,
        },
      ],
    });

    expect(metrics).toEqual({
      steps: 3,
      toolCalls: 5,
      toolFailures: 1,
      promptTokens: 150,
      nonCachedInputTokens: 90,
      cacheReadTokens: 60,
      outputTokens: 15,
      durationMs: 1_500,
    });
  });

  it("extracts the first opencode session id", () => {
    expect(
      extractSessionId(
        [
          '{"type":"step_start","sessionID":"ses_first"}',
          '{"type":"text","sessionID":"ses_second"}',
        ].join("\n"),
      ),
    ).toBe("ses_first");
    expect(extractSessionId("not json")).toBeUndefined();
  });

  it("parses and deduplicates opencode JSONL tool parts", () => {
    const text = [
      '{"type":"tool_use","part":{"id":"t1","tool":"read","state":{"status":"completed"}}}',
      '{"type":"tool_use","part":{"id":"t1","tool":"read","state":{"status":"completed"}}}',
      '{"type":"tool_use","part":{"id":"t2","tool":"shell","state":{"status":"error"}}}',
      '{"type":"step_finish","part":{"tokens":{"input":10,"output":2,"reasoning":1,"cache":{"read":5}}}}',
      '{"type":"step_finish","part":{"tokens":{"input":7,"output":3,"reasoning":0,"cache":{"read":2}}}}',
      "not json",
    ].join("\n");

    expect(parseOpenCodeJsonl(text)).toEqual({
      steps: 2,
      toolCalls: 2,
      toolFailures: 1,
      inputTokens: 17,
      cacheReadTokens: 7,
      outputTokens: 5,
      reasoningTokens: 1,
    });
  });

  it("summarizes medians and verify pass count", () => {
    const runs: SideRun[] = [
      {
        side: "larness",
        verify: 0,
        diffStat: "a",
        metrics: {
          steps: 4,
          toolCalls: 5,
          toolFailures: 0,
          promptTokens: 100,
          nonCachedInputTokens: 80,
          cacheReadTokens: 20,
          outputTokens: 10,
          durationMs: 1_000,
        },
      },
      {
        side: "larness",
        verify: 0,
        diffStat: "a",
        metrics: {
          steps: 6,
          toolCalls: 7,
          toolFailures: 1,
          promptTokens: 140,
          nonCachedInputTokens: 100,
          cacheReadTokens: 40,
          outputTokens: 20,
          durationMs: 1_500,
        },
      },
    ];

    expect(summarizeSide(runs)).toMatchObject({
      rounds: 2,
      verifyPass: 2,
      steps: 5,
      toolCalls: 6,
      toolFailures: 0.5,
      promptTokens: 120,
      nonCachedInputTokens: 90,
      cacheReadTokens: 30,
      outputTokens: 15,
      durationMs: 1_250,
    });
  });
});
