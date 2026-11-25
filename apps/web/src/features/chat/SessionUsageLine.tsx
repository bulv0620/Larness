import { cn, Hint } from "@larness/ui";
import type { ReactNode } from "react";
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

export function contextUsageInfo(
  used: number | null,
  limit: number | null,
  sessionTokens?: number | null,
): { known: boolean; percent: number; text: string; detail: string } {
  const cumulative =
    sessionTokens !== undefined && sessionTokens !== null && sessionTokens > 0
      ? ` · 会话 ${formatTokenCount(sessionTokens)}`
      : "";
  // A window without a request yet (brand-new session) is a real zero, not an
  // unknown value: the row must still show the window and 0% instead of
  // "暂无统计". Only a missing request value or window stays unknown.
  if (
    used !== null &&
    limit !== null &&
    Number.isFinite(used) &&
    used >= 0 &&
    Number.isFinite(limit) &&
    limit > 0
  ) {
    const percent = Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
    return {
      known: true,
      percent,
      text: `本轮 ${formatTokenCount(used)} / ${formatTokenCount(limit)} · ${percent}%${cumulative}`,
      detail: `本轮请求输入：${used.toLocaleString()} / ${limit.toLocaleString()} tokens（${percent}%）${
        cumulative === "" ? "" : ` · 会话累计输入 ${sessionTokens?.toLocaleString()} tokens`
      }`,
    };
  }
  const windowKnown = limit !== null && Number.isFinite(limit) && limit > 0;
  return {
    known: false,
    percent: 0,
    text: "暂无统计",
    detail: windowKnown
      ? `暂无统计 · 模型窗口 ${limit.toLocaleString()} tokens`
      : "暂无统计 · 模型窗口未知",
  };
}

export function ContextUsage({
  used,
  limit,
  sessionTokens,
}: {
  used: number | null;
  limit: number | null;
  sessionTokens?: number | null;
}) {
  const info = contextUsageInfo(used, limit, sessionTokens);
  return (
    <Hint label={info.detail} side="top">
      <div
        role="progressbar"
        aria-label="上下文用量"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={info.known ? info.percent : undefined}
        aria-valuetext={info.detail}
        className="flex shrink-0 items-center gap-1"
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 20 20"
          className="-rotate-90"
          fill="none"
        >
          <circle
            cx="10"
            cy="10"
            r="7"
            stroke="currentColor"
            strokeWidth="2"
            className="text-line-strong"
          />
          {info.known ? (
            <circle
              cx="10"
              cy="10"
              r="7"
              pathLength="100"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="100"
              strokeDashoffset={100 - info.percent}
              className={cn(
                "transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none",
                info.percent >= 90
                  ? "text-danger"
                  : info.percent >= 75
                    ? "text-warning"
                    : "text-accent",
              )}
            />
          ) : null}
        </svg>
        <span className="tabular-nums">{info.text}</span>
      </div>
    </Hint>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      aria-label="会话用量"
      className="mt-1 flex min-h-[16px] flex-wrap items-center gap-1 px-1 text-[10.5px] text-ink-3"
    >
      {children}
    </div>
  );
}

export function SessionUsageLine({
  usage,
  streaming,
  lastStep,
  contextUsage,
}: {
  usage: ApiSessionUsage | null | undefined;
  streaming: boolean;
  lastStep: { outputTokens: number; durationMs: number } | null;
  contextUsage: { used: number | null; limit: number | null; sessionTokens?: number | null };
}) {
  if (usage === null) {
    return (
      <Row>
        <span>Token 统计加载中…</span>
        <span className="flex-1" />
        <ContextUsage {...contextUsage} />
      </Row>
    );
  }

  if (usage === undefined) {
    return (
      <Row>
        <span className="flex-1" />
        <ContextUsage {...contextUsage} />
      </Row>
    );
  }

  const partial = usage.partial;
  const total = `${partial ? "≥ " : ""}${formatTokenCount(usage.totalTokens)} tokens`;
  const cachePercent = usage.cache.hitRate === null ? null : Math.round(usage.cache.hitRate * 100);
  const cacheDetail =
    usage.cache.knownRequests > 0
      ? [
          `缓存命中 ${formatTokenCount(usage.cache.readTokens)} tokens`,
          `未命中 ${formatTokenCount(usage.cache.missTokens)} tokens`,
          ...(usage.cache.unknownRequests > 0
            ? [`未知 ${usage.cache.unknownRequests} 次请求`]
            : []),
        ].join(" · ")
      : usage.cache.unknownRequests > 0
        ? `缓存未知 · ${usage.cache.unknownRequests} 次请求未回报缓存字段`
        : null;
  const detail = [
    `输入 ${formatTokenCount(usage.inputTokens)}`,
    `输出 ${formatTokenCount(usage.outputTokens)}`,
    ...(cacheDetail === null ? [] : [cacheDetail]),
    ...(partial ? [`缺失 ${usage.missingTurns} 轮`] : []),
  ].join(" · ");
  const speed =
    lastStep === null ? null : stepOutputSpeed(lastStep.outputTokens, lastStep.durationMs);

  return (
    <Row>
      <Hint label={detail} side="top">
        <span className="tabular-nums">{total}</span>
      </Hint>
      {cachePercent === null ? null : (
        <>
          <span aria-hidden="true">·</span>
          <Hint label={cacheDetail ?? "缓存命中率"} side="top">
            <span className="tabular-nums">缓存命中 {cachePercent}%</span>
          </Hint>
        </>
      )}
      {streaming && speed !== null && lastStep !== null ? (
        <>
          <span aria-hidden="true">·</span>
          <Hint
            label={`最后一步输出 ${formatTokenCount(lastStep.outputTokens)} tokens · ${formatDuration(lastStep.durationMs)}`}
            side="top"
          >
            <span className="tabular-nums">{speed} tok/s</span>
          </Hint>
        </>
      ) : null}
      <span className="flex-1" />
      <ContextUsage {...contextUsage} />
    </Row>
  );
}
