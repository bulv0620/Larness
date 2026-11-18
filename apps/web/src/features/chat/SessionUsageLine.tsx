import { Hint } from "@larness/ui";
import type { ApiSessionUsage } from "@/lib/workspaceApi";

export function formatTokenCount(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 100_000) {
    const value = (count / 1_000).toFixed(1);
    return `${value.endsWith(".0") ? value.slice(0, -2) : value}k`;
  }
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  const value = (count / 1_000_000).toFixed(2);
  return `${value.endsWith(".00") ? value.slice(0, -3) : value.endsWith("0") ? value.slice(0, -1) : value}M`;
}

export function stepOutputSpeed(
  outputTokens: number | undefined,
  durationMs: number | undefined,
): number | null {
  if (
    outputTokens === undefined ||
    durationMs === undefined ||
    outputTokens <= 0 ||
    durationMs <= 0
  ) {
    return null;
  }
  return Math.round(outputTokens / (durationMs / 1_000));
}

function formatDuration(durationMs: number): string {
  return durationMs >= 1_000 ? `${(durationMs / 1_000).toFixed(1)}s` : `${durationMs}ms`;
}

export function SessionUsageLine({
  usage,
  streaming,
  lastStep,
}: {
  usage: ApiSessionUsage | null;
  streaming: boolean;
  lastStep: { outputTokens: number; durationMs: number } | null;
}) {
  if (usage === null) return null;

  const partial = usage.partial;
  const total = `${partial ? "≥ " : ""}${formatTokenCount(usage.totalTokens)} tokens`;
  const detail = [
    `输入 ${formatTokenCount(usage.inputTokens)}`,
    `输出 ${formatTokenCount(usage.outputTokens)}`,
    ...(usage.cacheReadTokens === null
      ? []
      : [`缓存读取 ${formatTokenCount(usage.cacheReadTokens)}`]),
    ...(partial ? [`部分统计 · ${usage.missingTurns} 轮缺失`] : []),
  ].join(" · ");
  const speed =
    lastStep === null ? null : stepOutputSpeed(lastStep.outputTokens, lastStep.durationMs);

  return (
    <div
      role="status"
      aria-label="会话用量"
      className="mt-1 flex min-h-[16px] flex-wrap items-center gap-1 px-1 text-[10.5px] text-ink-3"
    >
      <Hint label={detail} side="top">
        <span className="tabular-nums">{total}</span>
      </Hint>
      {partial ? <span className="text-warning">· 部分统计</span> : null}
      {streaming && speed !== null && lastStep !== null ? (
        <>
          <span aria-hidden="true">·</span>
          <Hint
            label={`最后一步输出 ${formatTokenCount(lastStep.outputTokens)} tokens · ${formatDuration(lastStep.durationMs)}`}
            side="top"
          >
            <span className="tabular-nums text-ink-2">{speed} tok/s</span>
          </Hint>
        </>
      ) : null}
    </div>
  );
}
