import type { TimelineItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { MessageSquareText, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
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
        <div className={cn("h-1 shrink-0")} />
      </div>
    </div>
  );
}
