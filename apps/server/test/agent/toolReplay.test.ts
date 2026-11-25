import { describe, expect, it } from "vitest";
import {
  buildToolReplay,
  MAX_REPLAY_ARGS_CHARS,
  MAX_REPLAY_CONTENT_CHARS,
  parseToolReplay,
  REPLAY_MAX_TOKENS,
  REPLAY_MIN_TOKENS,
  replayBudgetTokens,
} from "../../src/modules/agent/turn/toolReplay.js";

describe("tool replay records", () => {
  it("redacts secret-shaped values before they reach the event table", () => {
    const replay = buildToolReplay({
      toolCallId: "call_1",
      toolName: "read_file",
      args: { path: ".env" },
      content: JSON.stringify({ path: ".env", content: "api_key=supersecretvalue" }),
    });

    expect(replay).not.toBeNull();
    expect(replay?.content).not.toContain("supersecretvalue");
    expect(replay?.content).toContain("[Redacted]");
  });

  it("refuses arguments that are too large to replay", () => {
    const replay = buildToolReplay({
      toolCallId: "call_1",
      toolName: "search_code",
      args: { query: "x".repeat(MAX_REPLAY_ARGS_CHARS + 1) },
      content: "ok",
    });

    expect(replay).toBeNull();
  });

  it("bounds oversized content instead of storing it whole", () => {
    const replay = buildToolReplay({
      toolCallId: "call_1",
      toolName: "read_file",
      args: { path: "big.ts" },
      content: "z".repeat(MAX_REPLAY_CONTENT_CHARS + 100),
    });

    expect(replay?.content.length).toBeLessThan(MAX_REPLAY_CONTENT_CHARS + 50);
    expect(replay?.content).toContain("[truncated for replay]");
  });

  it("round-trips through the event payload and rejects malformed rows", () => {
    const replay = buildToolReplay({
      toolCallId: "call_1",
      toolName: "read_file",
      args: { path: "a.ts" },
      content: JSON.stringify({ path: "a.ts", content: "alpha" }),
      isError: true,
    });

    expect(parseToolReplay(JSON.stringify(replay))).toMatchObject({
      toolCallId: "call_1",
      toolName: "read_file",
      isError: true,
    });
    expect(parseToolReplay("{not-json")).toBeNull();
    expect(parseToolReplay(JSON.stringify({ toolCallId: "call_1" }))).toBeNull();
  });

  it("scales the replay budget with the window and clamps it", () => {
    expect(replayBudgetTokens(128_000)).toBe(6_400);
    expect(replayBudgetTokens(1_000_000)).toBe(REPLAY_MAX_TOKENS);
    expect(replayBudgetTokens(1_000)).toBe(REPLAY_MIN_TOKENS);
  });
});
