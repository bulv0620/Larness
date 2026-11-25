import { describe, expect, it } from "vitest";
import { preserveCancellation } from "../../src/modules/agent/turn/budget.js";

describe("terminal status reconciliation", () => {
  it("keeps a user cancellation that landed during finalization", () => {
    expect(preserveCancellation("COMPLETED", "CANCELLING")).toBe("CANCELLED");
    expect(preserveCancellation("INTERRUPTED", "CANCELLING")).toBe("CANCELLED");
    expect(preserveCancellation("CANCELLED", "CANCELLING")).toBe("CANCELLED");
  });

  it("leaves ordinary terminal decisions untouched", () => {
    expect(preserveCancellation("COMPLETED", "RUNNING")).toBe("COMPLETED");
    expect(preserveCancellation("FAILED", null)).toBe("FAILED");
  });
});
