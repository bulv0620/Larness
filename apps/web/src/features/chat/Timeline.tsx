import type { ApprovalItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { Loader2, MessageSquareText, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { TimelineItemView } from "@/features/chat/TimelineItemView";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

const suggestions = [
  "把首页改成三栏工作台，并补上窗口层。",
  "检查当前端口，启动 dev server 并在浏览器预览。",
  "总结最近的 Git 改动，生成一段发布说明。",
];

function TurnActivity() {
  const items = useTimelineStore((state) => state.items);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const startedAt = useTimelineStore((state) => state.turnStartedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isStreaming) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [isStreaming]);

  if (!isStreaming) return null;

  const last = [...items].reverse();
  const approval = last.find(
    (item): item is ApprovalItem => item.kind === "approval" && item.status === "pending",
  );
  const tool = last.find(
    (item): item is ToolItem => item.kind === "tool" && item.status === "running",
  );
  const label =
    approval !== undefined
      ? "等待你批准工具调用"
      : tool !== undefined
        ? `正在执行 ${tool.name}`
        : "Agent 正在思考";
  const elapsed = startedAt === null ? null : Math.max(0, Math.floor((now - startedAt) / 1_000));

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-1 flex items-center gap-2 rounded-xl border border-accent/15 bg-accent-soft/35 px-3 py-2 text-[11px] text-ink-2"
    >
      {approval !== undefined ? (
        <ShieldAlert size={12} className="shrink-0 text-warning" />
      ) : tool !== undefined ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
      ) : (
        <Sparkles size={12} className="shrink-0 animate-pulse text-accent" />
      )}
      <span className="font-medium">{label}</span>
      <span className="inline-flex items-center gap-0.5 text-accent">
        <span className="activity-dot" />
        <span className="activity-dot [animation-delay:140ms]" />
        <span className="activity-dot [animation-delay:280ms]" />
      </span>
      <span className="ml-auto font-mono text-[10px] text-ink-3">
        {elapsed === null ? "进行中" : `${elapsed}s`}
      </span>
    </div>
  );
}

export function Timeline() {
  const items = useTimelineStore((state) => state.items);
  const loading = useTimelineStore((state) => state.loading);
  const focusComposer = useNavigationStore((state) => state.focusComposer);
  const hasSession = useNavigationStore((state) => Boolean(state.sessionId));
  const setDraft = useComposerStore((state) => state.setDraft);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is the scroll trigger
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [items]);

  if (!hasSession) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto">
        <div className="w-full max-w-[560px] px-6">
          <EmptyState
            icon={Sparkles}
            title="还没有会话"
            description="在左侧选择项目旁的 + 新建会话，或直接点击“新建会话”开始。"
          />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 space-y-3 overflow-hidden px-6 py-6">
        <div className="mx-auto max-w-[880px] space-y-3">
          <div className="h-14 w-2/3 animate-pulse rounded-xl bg-black/[.04] dark:bg-white/[.05]" />
          <div className="ml-auto h-10 w-1/2 animate-pulse rounded-xl bg-accent/10" />
          <div className="h-28 w-full animate-pulse rounded-xl bg-black/[.04] dark:bg-white/[.05]" />
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-1 items-center justify-center overflow-auto">
        <div className="w-full max-w-[560px] px-6">
          <EmptyState
            icon={Sparkles}
            title="开始新的对话"
            description="描述你想完成的任务，Agent 会读取项目、调用工具并在这里展示执行过程。"
          />
          <div className="mt-1 grid gap-1.5">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setDraft(suggestion);
                  focusComposer();
                }}
                className="flex items-center gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2 text-left text-[11.5px] text-ink-2 transition-colors hover:border-accent/25 hover:bg-accent-soft/50 hover:text-ink"
              >
                <MessageSquareText size={13} className="shrink-0 text-accent" />
                <span>{suggestion}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={(event) => {
        const element = event.currentTarget;
        pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 90;
      }}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      role="log"
      aria-label="会话时间线"
    >
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3 pb-6">
        {items.map((item: TimelineItem) => (
          <TimelineItemView key={item.id} item={item} />
        ))}
        <TurnActivity />
        <div className={cn("h-1 shrink-0")} />
      </div>
    </div>
  );
}
