import { TooltipProvider } from "@larness/ui";
import { render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { ApiSessionUsage } from "@/lib/workspaceApi";
import {
  contextUsageInfo,
  formatTokenCount,
  SessionUsageLine,
  stepOutputSpeed,
} from "./SessionUsageLine";

const usage: ApiSessionUsage = {
  sessionId: "ses_a",
  inputTokens: 1_200_000,
  outputTokens: 40_000,
  totalTokens: 1_240_000,
  cacheReadTokens: 900_000,
  noCacheTokens: 300_000,
  cache: {
    hitRate: 0.78,
    readTokens: 1_170_000,
    missTokens: 330_000,
    knownRequests: 5,
    unknownRequests: 1,
  },
  turns: 4,
  missingTurns: 0,
  partial: false,
  updatedAt: 10,
};

function renderLine(props: Omit<Parameters<typeof SessionUsageLine>[0], "contextUsage">) {
  return render(
    <TooltipProvider>
      <SessionUsageLine contextUsage={{ used: 32_000, limit: 128_000 }} {...props} />
    </TooltipProvider>,
  );
}

it("clamps context usage and reports unknown usage honestly", () => {
  expect(contextUsageInfo(null, 128_000)).toMatchObject({
    known: false,
    percent: 0,
    text: "暂无统计",
  });
  expect(contextUsageInfo(0, 128_000).known).toBe(false);
  expect(contextUsageInfo(256_000, 128_000)).toMatchObject({
    known: true,
    percent: 100,
    text: "本轮 256k / 128k · 100%",
  });
});

it("shows the session cumulative input next to the per-request window usage", () => {
  const info = contextUsageInfo(32_000, 128_000, 1_240_000);

  expect(info.text).toBe("本轮 32k / 128k · 25% · 会话 1.24M");
  expect(info.detail).toContain("本轮请求输入：32,000 / 128,000 tokens（25%）");
  expect(info.detail).toContain("会话累计输入 1,240,000 tokens");
});

it("shows bounded context usage in the session usage row", () => {
  const view = renderLine({ usage, streaming: false, lastStep: null });
  const row = view.getByRole("status", { name: "会话用量" });
  const ring = within(row).getByRole("progressbar", { name: "上下文用量" });

  expect(ring).toHaveAttribute("aria-valuenow", "25");
  expect(ring).toHaveAttribute("aria-valuetext", "本轮请求输入：32,000 / 128,000 tokens（25%）");
  expect(within(row).getByText("本轮 32k / 128k · 25%")).toBeVisible();
});

it("keeps the context ring when the session usage query is disabled", () => {
  const view = renderLine({ usage: undefined, streaming: false, lastStep: null });
  const row = view.getByRole("status", { name: "会话用量" });

  expect(row).not.toHaveTextContent("Token 统计加载中…");
  expect(within(row).getByRole("progressbar", { name: "上下文用量" })).toHaveAttribute(
    "aria-valuenow",
    "25",
  );
});

it("formats token totals compactly", () => {
  expect(formatTokenCount(0)).toBe("0");
  expect(formatTokenCount(999)).toBe("999");
  expect(formatTokenCount(1_000)).toBe("1k");
  expect(formatTokenCount(12_300)).toBe("12.3k");
  expect(formatTokenCount(123_000)).toBe("123k");
  expect(formatTokenCount(1_240_000)).toBe("1.24M");
});

it("computes speed only from measured output and duration", () => {
  expect(stepOutputSpeed(320, 8_000)).toBe(40);
  expect(stepOutputSpeed(0, 8_000)).toBeNull();
  expect(stepOutputSpeed(320, 0)).toBeNull();
  expect(stepOutputSpeed(undefined, 8_000)).toBeNull();
});

it("shows the session total and measured last-step speed", () => {
  renderLine({ usage, streaming: true, lastStep: { outputTokens: 320, durationMs: 8_000 } });

  expect(screen.getByRole("status", { name: "会话用量" })).toHaveTextContent("1.24M tokens");
  expect(screen.getByText("缓存命中 78%")).toBeVisible();
  expect(screen.getByText("40 tok/s")).toBeVisible();
  expect(screen.queryByText("部分统计")).toBeNull();
});

it("hides speed when the turn is not streaming", () => {
  renderLine({ usage, streaming: false, lastStep: { outputTokens: 320, durationMs: 8_000 } });
  expect(screen.queryByText("40 tok/s")).toBeNull();
});

it("marks partial aggregates instead of pretending completeness", () => {
  renderLine({
    usage: { ...usage, totalTokens: 12_300, partial: true, missingTurns: 2 },
    streaming: false,
    lastStep: null,
  });

  expect(screen.getByRole("status", { name: "会话用量" })).toHaveTextContent("≥ 12.3k tokens");
  expect(screen.queryByText(/部分统计/)).toBeNull();
  expect(screen.queryByText(/缺失/)).toBeNull();
});

it("hides the hit rate when no request reported cache fields", () => {
  renderLine({
    usage: {
      ...usage,
      cache: { hitRate: null, readTokens: 0, missTokens: 0, knownRequests: 0, unknownRequests: 3 },
    },
    streaming: false,
    lastStep: null,
  });

  expect(screen.queryByText(/缓存命中/)).toBeNull();
});

it("shows a loading row before usage is available", () => {
  const view = renderLine({ usage: null, streaming: false, lastStep: null });
  expect(view.getByRole("status", { name: "会话用量" })).toHaveTextContent("Token 统计加载中…");
});
