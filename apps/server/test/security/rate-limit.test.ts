import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../src/security/rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the limit and then rejects until the window resets", () => {
    const limiter = new RateLimiter();
    const now = 1_000;

    expect(limiter.consume("k", 2, 60_000, now).allowed).toBe(true);
    expect(limiter.consume("k", 2, 60_000, now + 1).allowed).toBe(true);

    const rejected = limiter.consume("k", 2, 60_000, now + 2);
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterMs).toBeGreaterThan(0);

    expect(limiter.consume("k", 2, 60_000, now + 60_001).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter();
    expect(limiter.consume("a", 1, 60_000, 1).allowed).toBe(true);
    expect(limiter.consume("a", 1, 60_000, 1).allowed).toBe(false);
    expect(limiter.consume("b", 1, 60_000, 1).allowed).toBe(true);
  });
});
