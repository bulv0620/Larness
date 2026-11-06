import type { MessageItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { ArrowDown, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { CommandCard } from "./CommandCard";
import { TimelineItemView } from "./TimelineItemView";
import { Welcome } from "./Welcome";

interface TurnGroup {
  id: string;
  items: TimelineItem[];
}
function groupTurns(items: TimelineItem[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const byId = new Map<string, TurnGroup>();
  let current: TurnGroup | undefined;
  for (const item of items) {
    const isUser = item.kind === "message" && item.role === "user";
    const id = item.turnId ?? (isUser ? item.id : (current?.id ?? item.id));
    const existing = byId.get(id);
    if (existing) {
      existing.items.push(item);
      if (isUser) current = existing;
    } else {
      const group = { id, items: [item] };
      groups.push(group);
      byId.set(id, group);
      current = group;
    }
  }
  return groups;
}

function TurnView({ group, active }: { group: TurnGroup; active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const items = group.items;
  const user = items.find(
    (item): item is MessageItem => item.kind === "message" && item.role === "user",
  );
  const tools = items.filter(
    (item): item is ToolItem => item.kind === "tool" && item.name !== "update_plan",
  );
  let lastOperation = -1;
  let lastAssistant = -1;
  items.forEach((item, index) => {
    if (item.kind === "tool") lastOperation = index;
    if (item.kind === "message" && item.role === "assistant") lastAssistant = index;
  });
  // A completed turn always ends with its last assistant message. Live event
  // delivery can interleave a tool completion after the final message; do not
  // hide the answer in that case. While the turn is active, only a message after
  // the last operation counts as final.
  const answer =
    lastAssistant >= 0 && (lastAssistant > lastOperation || user?.turnOutcome === "completed")
      ? items[lastAssistant]
      : undefined;
  const latestCommentary =
    active && !answer
      ? [...items].reverse().find((item) => item.kind === "message" && item.role === "assistant")
      : undefined;
  const process = items.filter(
    (item) =>
      item !== user &&
      item !== answer &&
      item !== latestCommentary &&
      ((item.kind === "message" && item.role === "assistant") ||
        (item.kind === "tool" && item.name !== "update_plan")),
  );
  const approvals = items.filter((item) => item.kind === "approval");
  const runningTool = [...tools].reverse().find((tool) => tool.status === "running");
  const pending = approvals.find((item) => item.kind === "approval" && item.status === "pending");
  const failed = user?.turnOutcome === "failed" || user?.turnOutcome === "interrupted";
  const stopped = user?.turnOutcome === "cancelled";
  const duration = user?.durationMs;
  const seconds = duration === undefined ? "" : ` · ${Math.round(duration / 1000)}秒`;
  const summary = active
    ? pending
      ? `本轮 ${tools.length} 项操作`
      : runningTool
        ? `正在执行 · ${runningTool.summary || runningTool.name}`
        : `已执行 ${tools.length} 项操作`
    : `${stopped ? "已停止" : failed ? "执行未完成" : "执行了"} ${tools.length} 项操作${seconds}`;
  const targets = new Map<string, NonNullable<ToolItem["resourceTarget"]>>();
  for (const tool of tools) {
    const target = tool.resourceTarget;
    if (target)
      targets.set(
        target.kind === "file"
          ? JSON.stringify([target.scope, target.path])
          : target.kind === "preview"
            ? `preview:${target.serviceId}:${target.path}`
            : target.terminalId,
        target,
      );
  }
  const filePaths = new Set(
    [...targets.values()].filter((target) => target.kind === "file").map((target) => target.path),
  );
  return (
    <section aria-label="对话轮次" className="min-w-0">
      {user ? <TimelineItemView item={user} /> : null}
      <div className="space-y-3">
        {process.length > 0 || tools.length > 0 ? (
          <div className="text-[12px] text-ink-3">
            <button
              type="button"
              aria-label={`执行过程 · ${summary}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className={cn(
                "flex w-full items-start gap-1.5 rounded-md py-1 text-left transition-colors hover:text-accent",
                active && !pending && "text-accent",
              )}
            >
              {active && !pending ? (
                <Loader2
                  size={13}
                  data-testid="turn-running-spinner"
                  className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                />
              ) : (
                <ChevronRight
                  size={13}
                  className={cn("mt-0.5 shrink-0", expanded && "rotate-90")}
                />
              )}
              <span className="min-w-0 break-words">{summary}</span>
            </button>
            {expanded ? (
              <div className="ml-1.5 mt-2 space-y-2 border-l border-accent/15 pl-4">
                {process.map((item) => (
                  <div key={item.id}>
                    <TimelineItemView item={item} />
                    {item.kind === "tool" && item.commandId ? (
                      <CommandCard commandId={item.commandId} />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {items
          .filter((item) => item.kind === "plan")
          .map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              turnActive={active && user?.turnOutcome === undefined}
            />
          ))}
        {latestCommentary ? <TimelineItemView item={latestCommentary} /> : null}
        {answer ? <TimelineItemView item={answer} /> : null}
        {active && !pending && !runningTool && !answer && !latestCommentary ? (
          <div role="status" className="flex items-center gap-2 text-[12px] text-ink-3">
            <Loader2 size={12} className="animate-spin text-accent motion-reduce:animate-none" />
            正在处理…
          </div>
        ) : null}
        {targets.size ? (
          <section aria-label="本次成果" className="flex flex-wrap gap-1.5 pt-0.5">
            {[...targets.entries()].map(([key, target]) =>
              target.kind === "file" ? (
                <FileResultCard key={key} target={target} />
              ) : target.kind === "preview" ? (
                <PreviewResultCard key={key} target={target} />
              ) : (
                <TerminalResultCard key={key} target={target} />
              ),
            )}
          </section>
        ) : null}
        {items
          .filter(
            (item) =>
              item.kind === "error" ||
              (item.kind === "artifact" && !filePaths.has(item.title.replace(/^已修改 /, ""))),
          )
          .map((item) => (
            <TimelineItemView key={item.id} item={item} />
          ))}
      </div>
    </section>
  );
}

export function Timeline() {
  const items = useTimelineStore((state) => state.items);
  const loading = useTimelineStore((state) => state.loading);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const activeTurnId = useTimelineStore((state) => state.activeTurnId);
  const sessionId = useNavigationStore((state) => state.sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const follow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (pinnedRef.current) element.scrollTop = element.scrollHeight;
    else setShowJump(element.scrollHeight - element.scrollTop - element.clientHeight > 140);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing session resets reading position
  useLayoutEffect(() => {
    pinnedRef.current = true;
    setShowJump(false);
  }, [sessionId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new output is the scroll trigger
  useLayoutEffect(follow, [items, loading]);
  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(scroll);
    observer.observe(content);
    return () => observer.disconnect();
  }, [follow]);
  const groups = groupTurns(items);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="log"
        aria-label="会话时间线"
        onClickCapture={(event) => {
          if (event.target instanceof Element && event.target.closest("button[aria-expanded]"))
            pinnedRef.current = false;
        }}
        onScroll={(event) => {
          const el = event.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          pinnedRef.current = distance < 70;
          setShowJump(distance > 140);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-7 [scrollbar-gutter:stable]"
      >
        <div ref={contentRef} className="mx-auto w-full max-w-[760px] space-y-8 pb-5">
          {loading ? (
            <div role="status" className="py-8 text-[12px] text-ink-3">
              正在加载对话…
            </div>
          ) : !items.length ? (
            <Welcome />
          ) : (
            groups.map((group, index) => (
              <TurnView
                key={`${sessionId}:${group.id}`}
                group={group}
                active={
                  isStreaming &&
                  (activeTurnId === group.id ||
                    (activeTurnId === null && index === groups.length - 1))
                }
              />
            ))
          )}
        </div>
      </div>
      <div aria-hidden="true" className="conversation-scroll-edge conversation-scroll-edge-top" />
      <div
        aria-hidden="true"
        className="conversation-scroll-edge conversation-scroll-edge-bottom"
      />
      {showJump ? (
        <button
          type="button"
          aria-label="回到最新消息"
          onClick={() => {
            pinnedRef.current = true;
            follow();
            setShowJump(false);
          }}
          className="absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-surface text-accent shadow-[var(--shadow-card)] transition-colors hover:bg-accent-soft"
        >
          <ArrowDown size={14} />
        </button>
      ) : null}
    </div>
  );
}
