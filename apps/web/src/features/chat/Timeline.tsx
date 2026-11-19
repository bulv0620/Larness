import type {
  FileResultTarget,
  MessageItem,
  PlanItem,
  TimelineItem,
  ToolItem,
  TurnBudgetCause,
  TurnFileResult,
} from "@larness/shared";
import { cn } from "@larness/ui";
import { ArrowDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { pendingApprovals } from "@/lib/pendingApprovals";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { ProcessFilesRow } from "./ProcessFilesRow";
import { MessageBubble, TimelineItemView } from "./TimelineItemView";

interface TurnGroup {
  id: string;
  items: TimelineItem[];
  /** Every turn merged into this group, in arrival order. */
  turnIds: string[];
  /**
   * Every slice's user message in arrival order, including the checkpoints the
   * UI never renders: they still carry the slice's outcome and file results.
   */
  users: MessageItem[];
}
function isUserMessage(item: TimelineItem): item is MessageItem {
  return item.kind === "message" && item.role === "user";
}

function isContinuationTurn(item: TimelineItem): item is MessageItem {
  return (
    item.kind === "message" && item.role === "user" && item.text.startsWith("Work state checkpoint")
  );
}

function groupTurns(items: TimelineItem[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  const byId = new Map<string, TurnGroup>();
  let current: TurnGroup | undefined;
  for (const item of items) {
    const isUser = item.kind === "message" && item.role === "user";
    // An automatically continued turn belongs to the task it continues, so it
    // reads as one flow instead of a new turn.
    if (isContinuationTurn(item) && item.turnId !== undefined && current !== undefined) {
      byId.set(item.turnId, current);
      current.turnIds.push(item.turnId);
      current.users.push(item);
      continue;
    }
    const id = item.turnId ?? (isUser ? item.id : (current?.id ?? item.id));
    const existing = byId.get(id);
    if (existing) {
      existing.items.push(item);
      if (item.turnId !== undefined && !existing.turnIds.includes(item.turnId)) {
        existing.turnIds.push(item.turnId);
      }
      if (isUser) {
        current = existing;
        existing.users.push(item);
      }
    } else {
      const group: TurnGroup = {
        id,
        items: [item],
        turnIds: item.turnId === undefined ? [] : [item.turnId],
        users: isUser ? [item] : [],
      };
      groups.push(group);
      byId.set(id, group);
      current = group;
    }
  }
  return groups;
}

/**
 * A continued chain keeps the first slice's id, so resolving the live group by
 * that id alone loses the running continuation and freezes the whole task into
 * a finished-looking state.
 */
function activeGroupOf(groups: TurnGroup[], activeTurnId: string | null): TurnGroup | undefined {
  if (activeTurnId === null) return groups.at(-1);
  return groups.find((group) => group.turnIds.includes(activeTurnId));
}

/**
 * The cause separates a continuable stop (`tokens` / `context`) from a stall
 * guard, so the label names the limit that actually fired instead of a generic
 * "budget". Older turns carry no cause and keep the old wording.
 */
function budgetStopLabel(cause: TurnBudgetCause | undefined): string {
  switch (cause) {
    case "tokens":
      return "已达花费上限";
    case "context":
      return "上下文已满";
    case "duration":
      return "执行超时中止";
    case "steps":
      return "步数已达上限";
    case "tool_calls":
      return "工具调用已达上限";
    default:
      return "预算停止";
  }
}

function useElapsedSeconds(active: boolean): number | null {
  const startedAt = useTimelineStore((state) => state.turnStartedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active || startedAt === null) return null;
  return Math.max(0, Math.floor((now - startedAt) / 1_000));
}

function ProcessSparkle() {
  return (
    <span aria-hidden="true" className="process-sparkle" data-active="true">
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path
          className="process-sparkle-main"
          d="M7.6 2.2c.5 4.2 1.9 5.6 6.1 6.1-4.2.5-5.6 1.9-6.1 6.1-.5-4.2-1.9-5.6-6.1-6.1 4.2-.5 5.6-1.9 6.1-6.1Z"
          fill="currentColor"
        />
        <path
          className="process-sparkle-small"
          d="M15.4 11.2c.3 2.3 1 3 3.3 3.3-2.3.3-3 1-3.3 3.3-.3-2.3-1-3-3.3-3.3 2.3-.3 3-1 3.3-3.3Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}

function runningToolLabel(tool: ToolItem): string {
  switch (tool.name) {
    case "run_command":
    case "run_shell":
      return "命令";
    case "read_file":
    case "list_files":
    case "search_code":
      return "读取";
    case "write_file":
    case "apply_patch":
      return "修改文件";
    case "start_process":
    case "list_processes":
    case "read_process_output":
    case "stop_process":
      return "后台进程";
    case "list_service_ops":
    case "read_service_ops_logs":
    case "control_service_ops":
      return "服务运维";
    default:
      return "";
  }
}

function TurnView({ group, active }: { group: TurnGroup; active: boolean }) {
  const send = useTimelineStore((state) => state.send);
  const resumeTurn = useTimelineStore((state) => state.resumeTurn);
  const items = group.items;
  const user = items.find(isUserMessage);
  // The chain reports the latest slice: the first one usually settled on a
  // budget while the last one is still working, so reading the first would
  // label a running task as finished and re-show its results mid-flight.
  const stateUser = group.users.at(-1) ?? user;
  const turnActive = active && stateUser?.turnOutcome === undefined;
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
  // hide the answer in that case. While the turn is active nothing counts as
  // final yet: process text stays in commentary style and only upgrades to the
  // answer style once the turn settles, so mid-turn bubbles never flicker.
  const answer =
    lastAssistant >= 0 &&
    !turnActive &&
    stateUser?.terminalReason !== "continued" &&
    (lastAssistant > lastOperation || stateUser?.turnOutcome === "completed")
      ? items[lastAssistant]
      : undefined;
  const latestCommentary =
    active && !answer
      ? [...items].reverse().find((item) => item.kind === "message" && item.role === "assistant")
      : undefined;
  // Each slice publishes its own plan id; a merged chain shows only the latest.
  const plan = items.filter((item): item is PlanItem => item.kind === "plan").at(-1);
  const process = items.filter(
    (item) =>
      item !== user &&
      item !== answer &&
      item !== latestCommentary &&
      ((item.kind === "message" && item.role === "assistant") ||
        (item.kind === "tool" && item.name !== "update_plan")),
  );
  const interrupted = stateUser?.turnOutcome === "interrupted";
  const failed = stateUser?.turnOutcome === "failed";
  const stopped = stateUser?.turnOutcome === "cancelled";
  const continuing = stateUser?.terminalReason === "continued";
  // The resume banner states the interruption and offers the way forward, so
  // the generic notice underneath would only repeat it and add a weaker second
  // action: resending the original text without the facts already gathered.
  const interruptedNotice =
    interrupted && stateUser.turnId !== undefined ? `interrupted_${stateUser.turnId}` : undefined;
  // A turn can end "completed" yet still be incomplete: budget stop or truncated output.
  const budgetStopped = stateUser?.terminalReason === "budget";
  const truncated = stateUser?.terminalReason === "output_truncated";
  // A chain's wall clock is the sum of its slices; each settled slice reports one.
  const duration = group.users.reduce<number | undefined>(
    (total, slice) => (slice.durationMs !== undefined ? (total ?? 0) + slice.durationMs : total),
    undefined,
  );
  const elapsed = useElapsedSeconds(turnActive);
  const waiting = turnActive && pendingApprovals(items).length > 0;
  const runningTool = [...items]
    .reverse()
    .find(
      (item): item is ToolItem =>
        item.kind === "tool" && item.name !== "update_plan" && item.status === "running",
    );
  const streamingReply =
    turnActive &&
    items.some((item) => item.kind === "message" && item.role === "assistant" && item.streaming);
  const streamingReasoning =
    turnActive && items.some((item) => item.kind === "reasoning" && item.streaming);
  let status: string;
  if (turnActive) {
    status = waiting
      ? "Waiting for approval..."
      : runningTool
        ? "Running..."
        : streamingReply
          ? "Generating..."
          : streamingReasoning
            ? "Thinking..."
            : "Starting...";
  } else {
    status = continuing
      ? "Continuing..."
      : stopped
        ? "Stopped"
        : interrupted
          ? "Interrupted"
          : failed
            ? "Failed"
            : "Completed";
  }
  const autoContinued = Math.max(0, group.users.length - 1);
  const secondary = [
    runningTool ? runningToolLabel(runningTool) : "",
    tools.length > 0 && turnActive ? `${tools.length} 步` : "",
    turnActive && elapsed !== null ? `${elapsed}s` : "",
    !turnActive && duration !== undefined ? `${Math.round(duration / 1000)}s` : "",
    !turnActive && tools.length > 0 ? `${tools.length} 步` : "",
    autoContinued > 0 ? `已自动继续 ${autoContinued} 次` : "",
    !turnActive && budgetStopped ? budgetStopLabel(stateUser?.budgetCause) : "",
    !turnActive && truncated ? "输出被截断" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // While the turn is running, failures stay inside the collapsible record; the
  // summary count keeps surfacing them without interrupting the flow. After the
  // turn ends they stay collapsed when there is an answer, and surface without
  // one, because then they explain the stop.
  const visibleProcess = expanded
    ? process
    : !turnActive && answer === undefined
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
  const fileTargets = new Map<string, FileResultTarget>();
  for (const target of targets.values()) {
    if (target.kind === "file") fileTargets.set(target.path, target);
  }
  // A turn settled with per-file dispositions renders from them, so temporary
  // and deleted files stay out of the results while remaining inspectable.
  // A chain accumulates them: every settled slice contributes its delivered
  // files, and a later slice wins on the same path.
  const accumulated = new Map<string, TurnFileResult>();
  let omitted = 0;
  for (const slice of group.users) {
    omitted += slice.fileResultsOmitted ?? 0;
    for (const file of slice.fileResults ?? []) accumulated.set(file.path, file);
  }
  const fileResults = accumulated.size === 0 ? undefined : [...accumulated.values()];
  const deliverablePaths = new Set(
    (fileResults ?? []).filter((file) => file.category === "deliverable").map((file) => file.path),
  );
  const processFiles = (fileResults ?? []).filter((file) => file.category === "process");
  const visibleTargets =
    fileResults === undefined
      ? [...targets.entries()]
      : [...targets.entries()].filter(
          ([, target]) => target.kind !== "file" || deliverablePaths.has(target.path),
        );
  const artifacts = items.filter((item) => {
    if (item.kind !== "artifact") return false;
    const titlePath = item.title.replace(/^已(?:修改|创建) /, "");
    // With per-file dispositions, file artifacts are represented by the cards.
    if (fileResults !== undefined) return titlePath === item.title;
    return !filePaths.has(titlePath);
  });
  const hasResults =
    visibleTargets.length > 0 || artifacts.length > 0 || processFiles.length > 0 || omitted > 0;
  const results =
    !turnActive && hasResults ? (
      <div className="mt-2 space-y-2">
        {visibleTargets.length > 0 ? (
          <section aria-label="本次成果" className="flex flex-wrap gap-1.5">
            {visibleTargets.map(([key, target]) =>
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
        <ProcessFilesRow files={processFiles} targets={fileTargets} />
        {omitted > 0 ? (
          <p className="text-[11px] text-ink-3">{`另有 ${omitted} 个文件未列出`}</p>
        ) : null}
      </div>
    ) : null;
  return (
    <section aria-label="对话轮次" className="min-w-0">
      {user ? <TimelineItemView item={user} /> : null}
      {plan ? (
        <TimelineItemView
          key={plan.id}
          item={plan}
          turnActive={turnActive}
          turnOutcome={stateUser?.turnOutcome}
        />
      ) : null}
      <div className="space-y-3">
        {process.length > 0 ||
        tools.length > 0 ||
        streamingReasoning ||
        waiting ||
        (turnActive && !answer) ? (
          <div className="text-[12px] text-ink-3">
            <button
              type="button"
              aria-label={`执行过程 · ${status}${secondary === "" ? "" : ` · ${secondary}`}`}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
              className="process-status-row flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:text-accent"
            >
              {turnActive ? <ProcessSparkle /> : null}
              <span
                className={cn(
                  "shrink-0 font-medium text-ink-2",
                  turnActive && "process-status-shimmer",
                )}
              >
                {status}
              </span>
              {secondary === "" ? null : (
                <span className="relative top-[0.5px] min-w-0 truncate text-[11px] text-ink-3">
                  {secondary}
                </span>
              )}
              <span className="flex-1" />
              <ChevronRight
                size={13}
                className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
              />
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
        {stateUser?.turnOutcome === "interrupted" && stateUser.turnId !== undefined ? (
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
                    void resumeTurn(stateUser.turnId ?? "");
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
          .filter((item) => item.kind === "error" && item.id !== interruptedNotice)
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
  const scrollToLatestNonce = useTimelineStore((state) => state.scrollToLatestNonce);
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
  const contentSignature = items
    .map((item) => (item.kind === "reasoning" ? "" : JSON.stringify(item)))
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: non-reasoning content is the scroll trigger
  useLayoutEffect(follow, [contentSignature, loading]);
  // Sending from a scrolled position re-attaches the transcript to the latest output.
  useLayoutEffect(() => {
    if (scrollToLatestNonce === 0) return;
    pinnedRef.current = true;
    setShowJump(false);
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [scrollToLatestNonce]);
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
  const activeGroup = isStreaming ? activeGroupOf(groups, activeTurnId) : undefined;
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
  );
}
