import type { MessageItem, PlanItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { ArrowDown, ChevronRight, Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { pendingApprovals } from "@/lib/pendingApprovals";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { MessageBubble, TimelineItemView } from "./TimelineItemView";

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

function summarizeTools(tools: ToolItem[]): string {
  let exploration = 0;
  let edits = 0;
  let commands = 0;
  for (const tool of tools) {
    if (tool.name === "run_command" || tool.commandId) commands++;
    else if (tool.name === "apply_patch") edits++;
    else if (["read_file", "list_files", "search_code"].includes(tool.name)) exploration++;
  }
  const other = tools.length - exploration - edits - commands;
  return (
    [
      exploration && `探索 ${exploration} 项`,
      edits && `修改 ${edits} 项`,
      commands && `命令 ${commands} 条`,
      other && `其他 ${other} 项`,
    ]
      .filter(Boolean)
      .join(" · ") || "执行了 0 项操作"
  );
}

function TurnView({ group, active }: { group: TurnGroup; active: boolean }) {
  const send = useTimelineStore((state) => state.send);
  const resumeTurn = useTimelineStore((state) => state.resumeTurn);
  const items = group.items;
  const user = items.find(
    (item): item is MessageItem => item.kind === "message" && item.role === "user",
  );
  const turnActive = active && user?.turnOutcome === undefined;
  const [expanded, setExpanded] = useState(false);
  const [confirmResume, setConfirmResume] = useState(false);
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
  const plans = items.filter((item): item is PlanItem => item.kind === "plan");
  const process = items.filter(
    (item) =>
      item !== user &&
      item !== answer &&
      item !== latestCommentary &&
      ((item.kind === "message" && item.role === "assistant") ||
        (item.kind === "tool" && item.name !== "update_plan")),
  );
  const failed = user?.turnOutcome === "failed" || user?.turnOutcome === "interrupted";
  const stopped = user?.turnOutcome === "cancelled";
  // A turn can end "completed" yet still be incomplete: budget stop or truncated output.
  const budgetStopped = user?.terminalReason === "budget";
  const truncated = user?.terminalReason === "output_truncated";
  const duration = user?.durationMs;
  const seconds = duration === undefined ? "" : ` · ${Math.round(duration / 1000)}秒`;
  const reasoningPreview = [...items].reverse().find((item) => item.kind === "reasoning")?.text;
  const showReasoning =
    turnActive &&
    reasoningPreview &&
    !tools.some((tool) => tool.status === "running") &&
    pendingApprovals(items).length === 0;
  const outcomeLabel = stopped
    ? "已停止"
    : failed
      ? "执行未完成"
      : budgetStopped
        ? "预算停止"
        : truncated
          ? "输出被截断"
          : "";
  const failures = tools.filter((tool) => tool.status === "error").length;
  const summary = [
    outcomeLabel,
    [summarizeTools(tools), failures > 0 ? `失败 ${failures} 项` : ""].filter(Boolean).join(" · ") +
      seconds,
  ]
    .filter(Boolean)
    .join(" · ");
  // Once the turn produced its answer, failures stay inside the collapsible
  // record. Without an answer they stay visible, because they explain the stop.
  const visibleProcess = expanded
    ? process
    : answer === undefined
      ? process.filter((item) => item.kind === "tool" && item.status === "error")
      : [];
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
  const artifacts = items.filter(
    (item) => item.kind === "artifact" && !filePaths.has(item.title.replace(/^已修改 /, "")),
  );
  const results =
    !turnActive && (targets.size > 0 || artifacts.length > 0) ? (
      <div className="mt-3 space-y-2 border-t border-line pt-2">
        {targets.size > 0 ? (
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
        {artifacts.map((item) => (
          <TimelineItemView key={item.id} item={item} />
        ))}
      </div>
    ) : null;
  return (
    <section aria-label="对话轮次" className="min-w-0">
      {user ? <TimelineItemView item={user} /> : null}
      {plans.map((item) => (
        <TimelineItemView key={item.id} item={item} turnActive={turnActive} />
      ))}
      <div className="space-y-3">
        {process.length > 0 || tools.length > 0 || reasoningPreview !== undefined ? (
          <div className="text-[12px] text-ink-3">
            <button
              type="button"
              aria-label={`执行过程 · ${showReasoning ? "正在思考 · " : ""}${summary}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-start gap-1.5 rounded-md py-1 text-left transition-colors hover:text-accent"
            >
              <ChevronRight size={13} className={cn("mt-0.5 shrink-0", expanded && "rotate-90")} />
              <span className="min-w-0">
                <span className="block break-words">{summary}</span>
                {showReasoning ? (
                  <span className="block truncate">正在思考 · {reasoningPreview}</span>
                ) : null}
              </span>
            </button>
            {visibleProcess.length > 0 ? (
              <div className="ml-1.5 mt-1 space-y-1 border-l border-line pl-3">
                {visibleProcess.map((item) => (
                  <TimelineItemView key={item.id} item={item} turnActive={turnActive} commentary />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {user?.turnOutcome === "interrupted" && user.turnId !== undefined ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink-2">
            {confirmResume ? (
              <>
                <span className="min-w-0 flex-1">
                  继续会新建一轮，并带上已完成文件、命令与失败诊断的核对事实；原轮次保持原样。
                </span>
                <button
                  type="button"
                  className="rounded border border-line px-2 py-0.5 text-ink transition-colors hover:text-accent"
                  onClick={() => {
                    setConfirmResume(false);
                    void resumeTurn(user.turnId ?? "");
                  }}
                >
                  确认继续
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-0.5 text-ink-3 transition-colors hover:text-ink"
                  onClick={() => setConfirmResume(false)}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1">上次执行被中断（服务重启或退出）。</span>
                <button
                  type="button"
                  className="rounded border border-line px-2 py-0.5 text-ink transition-colors hover:text-accent"
                  onClick={() => setConfirmResume(true)}
                >
                  继续这个任务
                </button>
              </>
            )}
          </div>
        ) : null}
        {latestCommentary ? <TimelineItemView item={latestCommentary} commentary /> : null}
        {answer?.kind === "message" ? (
          <MessageBubble item={answer} finalAnswer>
            {results}
          </MessageBubble>
        ) : (
          results
        )}
        {items
          .filter((item) => item.kind === "error")
          .map((item) => (
            <TimelineItemView
              key={item.id}
              item={item}
              onRetry={user ? () => void send(user.text) : undefined}
            />
          ))}
      </div>
    </section>
  );
}

export function Timeline() {
  const items = useTimelineStore((state) => state.items);
  const loading = useTimelineStore((state) => state.loading);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const contextNotice = useTimelineStore((state) => state.contextNotice);
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
  const activeGroup = isStreaming
    ? activeTurnId === null
      ? groups.at(-1)
      : groups.find((group) => group.id === activeTurnId)
    : undefined;
  const waiting = pendingApprovals(items).length > 0;
  const runningTool =
    activeGroup &&
    [...activeGroup.items]
      .reverse()
      .find(
        (item): item is ToolItem =>
          item.kind === "tool" && item.name !== "update_plan" && item.status === "running",
      );
  const replying = activeGroup?.items.some(
    (item) => item.kind === "message" && item.role === "assistant" && item.streaming,
  );
  let activity = "";
  if (waiting) activity = "等待审批";
  else if (runningTool)
    activity = `正在执行 · ${runningTool.commandLabel || runningTool.summary || runningTool.name}`;
  else if (replying) activity = "正在回复…";
  else if (isStreaming) activity = "正在处理…";
  return (
    <>
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
            {contextNotice ? (
              <p role="status" className="text-[11px] text-ink-3">
                上下文已压缩{contextNotice.degraded ? "（降级：超出部分已截断）" : ""}
              </p>
            ) : null}
            {loading ? (
              <div role="status" className="py-8 text-[12px] text-ink-3">
                正在加载对话…
              </div>
            ) : (
              groups.map((group) => (
                <TurnView
                  key={`${sessionId}:${group.id}`}
                  group={group}
                  active={activeGroup === group}
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
      {activity ? (
        <div className="shrink-0 px-4 sm:px-7">
          <div
            role="status"
            aria-label="当前执行状态"
            className="mx-auto flex w-full max-w-[760px] items-center gap-2 py-1.5 text-[12px] text-ink-2"
          >
            {waiting ? (
              <ShieldAlert size={13} className="shrink-0 text-warning" />
            ) : (
              <Loader2
                size={13}
                data-testid="turn-running-spinner"
                className="shrink-0 animate-spin text-accent motion-reduce:animate-none"
              />
            )}
            <span className="min-w-0 truncate" title={activity}>
              {activity}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
