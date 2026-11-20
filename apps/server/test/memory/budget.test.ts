import { describe, expect, it } from "vitest";
import type { MemoryRow } from "../../src/db/schema.js";
import {
  DAY_MS,
  evictionOrder,
  isMemoryStale,
  MEMORY_LIMITS,
  memoryBytes,
  memoryScore,
} from "../../src/modules/memory/budget.js";

function row(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: "mem_1",
    scope: "project",
    projectId: "prj_1",
    projectKey: "prj_1",
    kind: "fact",
    key: "build.test.command",
    title: "Test command",
    body: "pnpm test",
    status: "active",
    confidence: 0.8,
    evidenceKind: "file_observed",
    sourceTurnId: null,
    sourceEventSeq: null,
    createdBy: "agent",
    useCount: 0,
    lastUsedAt: null,
    lastConfirmedAt: 1_000,
    correctionCount: 0,
    pinned: false,
    bytes: 40,
    verifiedAt: 1_000,
    expiresAt: null,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe("memory budget", () => {
  it("counts UTF-8 bytes, not JavaScript code units", () => {
    expect(memoryBytes("k", "t", "中文")).toBe(1 + 1 + 6);
    expect(memoryBytes("key", "title", "body")).toBe(12);
  });

  it("marks mutable facts stale after 30 days and decisions after 180 days", () => {
    expect(isMemoryStale(row(), 1_000 + 30 * DAY_MS + 1)).toBe(true);
    expect(isMemoryStale(row({ kind: "decision" }), 1_000 + 30 * DAY_MS + 1)).toBe(false);
    expect(isMemoryStale(row({ kind: "decision" }), 1_000 + 180 * DAY_MS + 1)).toBe(true);
    expect(isMemoryStale(row({ kind: "preference" }), 1_000 + 10 * 365 * DAY_MS)).toBe(false);
  });

  it("scores used, recent, low-correction memories above stale, corrected ones", () => {
    const now = 1_000 + 40 * DAY_MS;
    const fresh = row({ useCount: 6, lastUsedAt: now - DAY_MS, verifiedAt: now - DAY_MS });
    const stale = row({ useCount: 0, lastUsedAt: 1_000, verifiedAt: 1_000, correctionCount: 3 });
    expect(memoryScore(fresh, now)).toBeGreaterThan(memoryScore(stale, now));
  });

  it("evicts the lowest non-pinned score first", () => {
    const now = 2_000;
    const low = row({ id: "mem_low", key: "a.low", confidence: 0.2 });
    const high = row({ id: "mem_high", key: "b.high", confidence: 0.9 });
    const pinned = row({ id: "mem_pinned", key: "c.pinned", confidence: 0.1, pinned: true });

    expect(evictionOrder([high, low, pinned], now).map((item) => item.id)).toEqual([
      "mem_low",
      "mem_high",
    ]);
    expect(MEMORY_LIMITS.project.totalBytes).toBeGreaterThan(MEMORY_LIMITS.project.activeBytes);
  });
});
