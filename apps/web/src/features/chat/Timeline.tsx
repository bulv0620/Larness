import type { ApprovalItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import {
  ArrowDown,
  Check,
  ChevronDown,
  Loader2,
  ShieldAlert,
  Sparkles,
  Wrench,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/EmptyState";
import { TimelineItemView } from "@/features/chat/TimelineItemView";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

function TimelineItems({ items }: { items: TimelineItem[] }) {
  const lastAssistantByTurn = new Map<string, number>();

  items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "assistant" && item.turnId !== undefined) {
      lastAssistantByTurn.set(item.turnId, index);
    }
  });

  const visible = items.filter((item, index) => {
    if (item.kind !== "message" || item.role !== "assistant" || item.turnId === undefined) {
      return true;
    }

    return lastAssistantByTurn.get(item.turnId) === index;
  });

  const nodes: React.ReactNode[] = [];
  let tools: ToolItem[] = [];

  const flush = () => {
    if (tools.length === 1) {
      const tool = tools[0];
      if (tool) nodes.push(<TimelineItemView key={tool.id} item={tool} />);
    } else if (tools.length > 1) {
      nodes.push(<ToolGroup key={`tools_${tools[0]?.id ?? "group"}`} tools={tools} />);
    }
    tools = [];
  };

  for (const item of visible) {
    if (item.kind === "tool") {
      tools.push(item);
      continue;
    }
    flush();
    nodes.push(<TimelineItemView key={item.id} item={item} />);
  }
  flush();

  return <>{nodes}</>;
}

function ToolGroup({ tools }: { tools: ToolItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const running = tools.some((tool) => tool.status === "running");
  const failed = tools.some((tool) => tool.status === "error");
  const names = [...new Set(tools.map((tool) => tool.name))];
  const summary =
    names.length <= 2 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} +${names.length - 2}`;

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2/55">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-line bg-surface">
          <Wrench
            size={11.5}
            className={running ? "text-accent" : failed ? "text-danger" : "text-ink-3"}
          />
        </span>
        <span className="text-[11.5px] font-medium text-ink">
          {running ? `正在执行 ${tools.length} 个工具` : `执行了 ${tools.length} 个工具`}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{summary}</span>
        {running ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
        ) : failed ? (
          <XCircle size={12} className="shrink-0 text-danger" />
        ) : (
          <Check size={12} className="shrink-0 text-success" />
        )}
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-ink-3 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="space-y-1.5 border-t border-line/80 p-1.5">
          {tools.map((tool) => (
            <TimelineItemView key={tool.id} item={tool} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  const hasSession = useNavigationStore((state) => Boolean(state.sessionId));
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: items is the scroll trigger
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
    setShowJumpToBottom(false);
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
        </div>
      </div>
    );
  }

  const scrollToBottom = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    pinnedRef.current = true;
    setShowJumpToBottom(false);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
          pinnedRef.current = distance < 90;
          setShowJumpToBottom(distance > 150);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-label="会话时间线"
      >
        <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3 pb-6">
          <TimelineItems items={items} />
          <TurnActivity />
          <div className={cn("h-1 shrink-0")} />
        </div>
      </div>
      {showJumpToBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="回到最新消息"
          title="回到最新消息"
          className="absolute bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface/95 text-ink-2 shadow-[var(--shadow-pop)] backdrop-blur transition-colors hover:bg-surface hover:text-ink"
        >
          <ArrowDown size={14} />
        </button>
      ) : null}
    </div>
  );
}
