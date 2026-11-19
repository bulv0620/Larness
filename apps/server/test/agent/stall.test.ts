import { describe, expect, it } from "vitest";
import { isStalled } from "../../src/modules/agent/turn/stall.js";

describe("isStalled", () => {
  it("triggers only after the configured no-progress window", () => {
    expect(isStalled(1_000, 1_000, 10_000)).toBe(false);
    expect(isStalled(1_000, 10_999, 10_000)).toBe(false);
    expect(isStalled(1_000, 11_001, 10_000)).toBe(true);
  });

  it("can be disabled", () => {
    expect(isStalled(1_000, 999_999_999, 0)).toBe(false);
  });
});
