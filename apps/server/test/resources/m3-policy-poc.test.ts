import { decideToolAccess } from "@larness/agent";
import { expect, it } from "vitest";

it("maps a temporary preview registration (L2) through the real approval policy", () => {
  // M3-1 reuses this policy for the registration action; invalid targets are still
  // rejected by identity binding (see m3-poc.test.ts), never by policy alone.
  expect(decideToolAccess("autonomous", "L2")).toBe("allow");
  expect(decideToolAccess("standard", "L2")).toBe("require_approval");
  expect(decideToolAccess("strict", "L2")).toBe("require_approval");
  expect(decideToolAccess("readonly", "L2")).toBe("deny");
  expect(decideToolAccess("standard", "L3")).toBe("deny");
});
