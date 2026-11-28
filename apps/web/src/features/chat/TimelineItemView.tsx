import type { ArtifactItem, MessageItem, PlanItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { Check, ChevronRight, Circle, Copy, Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { screenshotUrl } from "@/lib/workspaceApi";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore } from "@/stores/windowStore";
import { AttachmentStrip } from "./AttachmentStrip";
import { CommandCard } from "./CommandCard";
import { MarkdownText } from "./MarkdownText";

export function TimelineItemView({
  item,
  turnActive = false,
  turnOutcome,
  commentary = false,
  onRetry,
}: {
  item: TimelineItem;
  turnActive?: boolean;
  /** Which way this turn settled; a plan reads its open steps from it. */
  turnOutcome?: MessageItem["turnOutcome"];
  commentary?: boolean;
  onRetry?: () => void;
}) {
  switch (item.kind) {
    case "message":
      return <MessageBubble item={item} commentary={commentary} />;
    case "plan":
      return <PlanCard item={item} turnActive={turnActive} turnOutcome={turnOutcome} />;
    case "tool":
      return <ToolCard item={item} />;
    case "reasoning":
      return null;
    case "approval":
      return null;
    case "artifact":
      return <ArtifactResult item={item} />;
    case "error":
      return (
        <div
          role="status"
          className="border-l-2 border-danger/50 pl-3 text-[12px] leading-5 text-ink-2"
        >
          {item.message}
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="ml-2 text-[11px] text-accent hover:underline"
            >
              重试
            </button>
          ) : null}
        </div>
      );
  }
}

export function MessageBubble({
  item,
  children,
  commentary = false,
  finalAnswer = false,
}: {
  item: MessageItem;
  children?: ReactNode;
  commentary?: boolean;
  finalAnswer?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const currentSessionId = useNavigationStore((state) => state.sessionId);
  if (item.role === "user" && item.text.startsWith("Work state checkpoint")) {
    // Automatic continuation carries machine facts; show a compact marker
    // instead of dumping the checkpoint into the conversation.
    return (
      <div className="mb-5 flex justify-end">
        <div className="max-w-[91%] rounded-[18px] bg-surface-2 px-3.5 py-2.5 text-[12px] leading-[1.65] text-ink-2 sm:max-w-[82%]">
          <div className="text-ink">自动继续上一轮的未完成工作</div>
          <div className="mt-0.5">已带上已完成文件、命令与失败诊断的核对事实。</div>
          <button
            type="button"
            className="mt-1 text-[11px] text-ink-3 transition-colors hover:text-accent"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起核对事实" : "查看核对事实"}
          </button>
          {expanded ? (
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-3">
              {item.text}
            </pre>
          ) : null}
        </div>
      </div>
    );
  }
  // New events carry a ref for every attachment; `screenshots` only survives on
  // pre-088 events, where the ids are the inline images themselves. Rendering
  // ids as images on new events duplicated the tags and painted documents
  // (e.g. a PDF) as a broken "用户截图" thumbnail.
  const screenshots =
    item.attachments && item.attachments.length > 0 ? undefined : item.screenshots;
  if (item.role === "user")
    return (
      <div className="mb-5 flex flex-col items-end gap-1.5">
        {item.text ? (
          <div className="max-w-[91%] rounded-[18px] bg-accent-soft px-3.5 py-2.5 text-[13px] leading-[1.65] text-ink sm:max-w-[82%]">
            <div
              className={cn(
                "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
                !expanded && item.text.length > 1200 && "line-clamp-8",
              )}
            >
              {item.text}
            </div>
            {item.text.length > 1200 ? (
              <button
                type="button"
                className="mt-1 text-[11px] text-ink-3"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "收起" : "展开消息"}
              </button>
            ) : null}
          </div>
        ) : null}
        {item.attachments && item.attachments.length > 0 && currentSessionId ? (
          <AttachmentStrip sessionId={currentSessionId} attachments={item.attachments} />
        ) : null}
        {screenshots ? (
          <div className="flex flex-wrap justify-end gap-2">
            {screenshots.ids.map((id) => (
              <LegacyScreenshot key={id} src={screenshotUrl(screenshots.sessionId, id)} />
            ))}
          </div>
        ) : null}
      </div>
    );
  return (
    <article
      className={cn(
        "min-w-0 break-words leading-[1.65] [overflow-wrap:anywhere]",
        commentary ? "text-[12px] text-ink-2" : "text-[13px] text-ink",
      )}
    >
      {item.text ? (
        <div
          data-testid={finalAnswer ? "final-answer-bubble" : "message-bubble"}
          className={cn(
            "w-fit min-w-0 max-w-full rounded-2xl rounded-tl-md border border-line bg-surface",
            commentary ? "px-3 py-2" : "px-3.5 py-2.5",
          )}
        >
          <MarkdownText text={item.text} />
        </div>
      ) : null}
      {children}
      {!item.streaming && item.text ? (
        <div className="mt-2 flex items-center gap-2 px-0.5">
          <button
            type="button"
            aria-label={copied ? "已复制答复" : "复制答复"}
            className="rounded p-1 text-ink-3 hover:bg-surface-2"
            onClick={() => {
              void navigator.clipboard
                .writeText(item.text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <time
            dateTime={new Date(item.createdAt).toISOString()}
            title={new Date(item.createdAt).toLocaleString()}
            className="font-mono text-[11px] text-ink-3"
          >
            {new Date(item.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            })}
          </time>
        </div>
      ) : null}
    </article>
  );
}

/** Pre-088 screenshots have no metadata; a missing file must not paint a broken image. */
function LegacyScreenshot({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="rounded-md border border-line bg-surface-2 px-2 py-1 text-[11px] text-ink-3">
        截图不可用
      </span>
    );
  }
  return (
    <img
      src={src}
      alt="用户截图"
      className="max-h-48 max-w-full rounded-lg object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

type PlanStepStatus = PlanItem["steps"][number]["status"];
/** A settled step keeps the model's status or explains why it stayed open. */
type PlanStepDisplay = PlanStepStatus | "interrupted" | "unmarked";

/**
 * A settled turn keeps the model's last report. A step still `running` then was
 * cut off, not failed, so it reads the reason from the turn's outcome instead of
 * borrowing the failure mark. A manual stop reads like a failed turn.
 */
function displayStepStatus(
  status: PlanStepStatus,
  turnActive: boolean,
  outcome: MessageItem["turnOutcome"],
): PlanStepDisplay {
  if (status !== "running" || turnActive) return status;
  switch (outcome) {
    case "cancelled":
    case "failed":
    case "interrupted":
      return "interrupted";
    default:
      return "unmarked";
  }
}

const planStepLabels: Record<PlanStepDisplay, string> = {
  done: "已完成：",
  running: "进行中：",
  failed: "失败：",
  pending: "待做：",
  interrupted: "已中断",
  unmarked: "未标记完成",
};

/** Why a step is still open is stated in words, so it also reads out loud. */
const planStepStated = new Set<PlanStepDisplay>(["interrupted", "unmarked"]);

function PlanCard({
  item,
  turnActive,
  turnOutcome,
}: {
  item: PlanItem;
  turnActive: boolean;
  turnOutcome?: MessageItem["turnOutcome"];
}) {
  const total = item.steps.length;
  const done = item.steps.filter((step) => step.status === "done").length;
  const failed = item.steps.filter((step) => step.status === "failed").length;
  // A settled plan reports how many steps it left open: a turn can end while the
  // model never marked them, and the count says so without claiming they failed.
  const open = turnActive
    ? 0
    : item.steps.filter((step) => step.status === "running" || step.status === "pending").length;
  // The card is a list, not a status line: steps are always visible, so the
  // summary stays one sentence for assistive tech instead of a collapsed row.
  const summary = `计划 · ${done}/${total} · ${item.title}${
    open > 0 ? ` · 另有 ${open} 步未完成` : ""
  }`;
  return (
    // The fill separates the plan from the process row below it; the compact
    // width keeps four short steps from stretching into a full-width band.
    <div className="mb-2 min-w-0 rounded-lg bg-surface-3 px-2.5 py-2 text-[12px] text-ink-2 sm:max-w-[28rem]">
      <div aria-hidden="true" className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 font-medium">计划</span>
        <span className="shrink-0 text-[11px] tabular-nums">
          {done}/{total}
        </span>
        <span className="flex-1" />
        {failed > 0 ? (
          <span className="shrink-0 text-[10.5px] text-danger">{failed} 步失败</span>
        ) : open > 0 ? (
          <span className="shrink-0 text-[10.5px]">{open} 步未完成</span>
        ) : null}
      </div>
      <ol aria-label={summary} className="space-y-[3px]">
        {item.steps.map((step) => {
          const status = displayStepStatus(step.status, turnActive, turnOutcome);
          return (
            <li
              key={step.id}
              aria-current={status === "running" ? "step" : undefined}
              className="flex items-start gap-1.5"
            >
              {status === "done" ? (
                <Check size={13} className="mt-[2px] shrink-0 text-success" />
              ) : status === "running" ? (
                <Loader2
                  size={13}
                  className="mt-[2px] shrink-0 animate-spin text-accent motion-reduce:animate-none"
                />
              ) : status === "failed" ? (
                <X size={13} className="mt-[2px] shrink-0 text-danger" />
              ) : (
                <Circle size={13} className="mt-[2px] shrink-0 text-ink-3" />
              )}
              <span
                className={cn("min-w-0 flex-1 break-words", status === "running" && "text-ink")}
              >
                {step.title}
                <span
                  className={cn(planStepStated.has(status) ? "ml-2" : "sr-only", "text-[11px]")}
                >
                  {planStepLabels[status]}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="min-w-0 text-[12px] text-ink-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-1.5 rounded-md py-1 text-left transition-colors hover:text-accent"
      >
        <ChevronRight size={13} className={cn("mt-0.5 shrink-0", expanded && "rotate-90")} />
        <span
          className={cn(
            "min-w-0 [overflow-wrap:anywhere]",
            item.commandLabel && "line-clamp-2 font-mono",
          )}
        >
          {item.commandLabel || item.summary || item.name}
        </span>
        {item.status === "error" ? (
          <span className="ml-auto flex shrink-0 items-center gap-0.5 text-danger">
            <X size={13} /> 失败
            {item.retried === true ? <span className="text-ink-3">· 已重试</span> : null}
          </span>
        ) : null}
      </button>
      {expanded ? (
        <div className="ml-5 space-y-2">
          <div className="text-[11px]">
            {item.name}
            {item.durationMs !== undefined ? ` · ${Math.round(item.durationMs / 1000)}秒` : ""}
          </div>
          {item.args ? (
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2.5 font-mono text-[12px] text-ink-2">
              {item.args}
            </pre>
          ) : null}
          {item.output ? (
            <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2.5 font-mono text-[12px] text-ink-2">
              {item.output}
            </pre>
          ) : null}
          {item.commandId ? <CommandCard commandId={item.commandId} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ArtifactResult({ item }: { item: ArtifactItem }) {
  const open = useWindowStore((state) => state.open);
  const { projectId, sessionId } = useNavigationStore();
  if (item.resourceTarget?.kind === "file") return <FileResultCard target={item.resourceTarget} />;
  if (item.resourceTarget?.kind === "preview")
    return <PreviewResultCard target={item.resourceTarget} />;
  if (item.resourceTarget?.kind === "terminal")
    return <TerminalResultCard target={item.resourceTarget} />;
  return (
    <div className="break-words text-[12px] text-ink-2">
      <span>{item.title}</span>
      <p className="mt-1 text-ink-3">{item.description}</p>
      {item.href ? (
        <button
          type="button"
          className="mt-1 text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
          onClick={() =>
            open({
              kind: "browser",
              resourceId: item.href ?? item.id,
              title: item.title,
              projectId,
              sessionId,
              source: "artifact",
            })
          }
        >
          打开 {item.title}
        </button>
      ) : null}
    </div>
  );
}
