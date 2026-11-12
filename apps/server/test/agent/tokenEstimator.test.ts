import { describe, expect, it } from "vitest";
import {
  calibrateEstimate,
  contextWatermark,
  estimateRequestTokens,
  estimateTextTokens,
  reservedOutputTokens,
} from "../../src/modules/agent/tokenEstimator.js";

describe("token estimation", () => {
  it("estimates ASCII source at roughly four characters per token", () => {
    const source = "const value = 1;\n".repeat(100);

    expect(estimateTextTokens(source)).toBeGreaterThan(source.length / 5);
    expect(estimateTextTokens(source)).toBeLessThan(source.length / 3);
  });

  it("counts Chinese text far above ASCII for the same character count", () => {
    const chinese = "这是一段用于估算的中文文本，包含标点符号。".repeat(20);
    const ascii = "a".repeat(chinese.length);

    expect(estimateTextTokens(chinese)).toBeGreaterThan(estimateTextTokens(ascii) * 2);
    expect(estimateTextTokens(chinese)).toBeGreaterThanOrEqual(chinese.length * 0.8);
  });

  it("counts escaped command arguments without under-estimating", () => {
    const args = JSON.stringify({ args: ["run", "build", '--message="a b c"', "x".repeat(400)] });

    expect(estimateTextTokens(args)).toBeGreaterThanOrEqual(80);
  });

  it("includes tool schemas in the request estimate", () => {
    const messages = [{ role: "user" as const, content: "hi" }];
    const tools = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
      },
    ];

    expect(estimateRequestTokens(messages, tools)).toBeGreaterThan(
      estimateRequestTokens(messages, []),
    );
  });

  it("anchors the heuristic to the provider's reported input tokens", () => {
    expect(
      calibrateEstimate({
        heuristicTokens: 2_000,
        anchoredHeuristicTokens: undefined,
        anchoredProviderTokens: undefined,
      }),
    ).toBe(2_000);

    // The provider reported twice our heuristic; the request grew by 1.5x since.
    expect(
      calibrateEstimate({
        heuristicTokens: 3_000,
        anchoredHeuristicTokens: 2_000,
        anchoredProviderTokens: 4_000,
      }),
    ).toBe(6_000);
  });

  it("applies soft and hard watermarks and reserves output room", () => {
    expect(contextWatermark(10, 100)).toBe("ok");
    expect(contextWatermark(75, 100)).toBe("soft");
    expect(contextWatermark(95, 100)).toBe("hard");
    expect(contextWatermark(10, 0)).toBe("hard");

    expect(reservedOutputTokens({ maxOutputTokens: 8_192, contextWindow: 100_000 })).toBe(8_192);
    expect(reservedOutputTokens({ maxOutputTokens: 8_192, contextWindow: 10_000 })).toBe(1_500);
    // Without a configured cap the reserve still assumes a default answer size.
    expect(reservedOutputTokens({ maxOutputTokens: 0, contextWindow: 100_000 })).toBe(8_192);
    expect(reservedOutputTokens({ maxOutputTokens: 0, contextWindow: 10_000 })).toBe(1_500);
  });
});
