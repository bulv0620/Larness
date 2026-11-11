import type { ArtifactItem, MessageItem, PlanItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { Check, ChevronRight, Circle, Copy, Loader2, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore } from "@/stores/windowStore";
import { CommandCard } from "./CommandCard";
import { MarkdownText } from "./MarkdownText";

export function TimelineItemView({
  item,
  turnActive = false,
  commentary = false,
  onRetry,
}: {
  item: TimelineItem;
  turnActive?: boolean;
  commentary?: boolean;
  onRetry?: () => void;
}) {
  switch (item.kind) {
    case "message":
      return <MessageBubble item={item} commentary={commentary} />;
    case "plan":
      return <PlanCard item={item} turnActive={turnActive} />;
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
          className={cn(
            "border-l-2 pl-3 text-[12px] leading-5",
            /已停止/.test(item.message) ? "border-line text-ink-3" : "border-danger/50 text-ink-2",
          )}
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
  if (item.role === "user")
    return (
      <div className="mb-5 flex justify-end">
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
      </div>
    );
  return (
    <article
      className={cn(
        "min-w-0 break-words leading-[1.65] [overflow-wrap:anywhere]",
        commentary ? "text-[12px] text-ink-2" : "text-[13px] text-ink",
      )}
    >
      {finalAnswer && item.text ? (
        <div
          data-testid="final-answer-bubble"
          className="w-fit min-w-0 max-w-full rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5"
        >
          <MarkdownText text={item.text} />
        </div>
      ) : (
        <MarkdownText text={item.text} />
      )}
      {children}
      {!item.streaming && item.text ? (
        <div className="mt-1 flex items-center gap-2 px-0.5">
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

const planStepLabels = {
  done: "已完成：",
  running: "进行中：",
  failed: "失败：",
  pending: "待做：",
  unfinished: "未完成",
};

function PlanCard({ item, turnActive }: { item: PlanItem; turnActive: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const done = item.steps.filter((step) => step.status === "done").length;
  const current = turnActive ? item.steps.find((step) => step.status === "running") : undefined;
  return (
    <div className="text-[12px] text-ink-3">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-start gap-1.5 rounded-md py-1 text-left transition-colors hover:text-accent"
      >
        <ChevronRight size={13} className={cn("mt-0.5 shrink-0", expanded && "rotate-90")} />
        <span className={current ? "text-accent" : undefined}>
          计划 · {done}/{item.steps.length}
          {current ? ` · ${current.title}` : ` · ${item.title}`}
        </span>
      </button>
      {expanded ? (
        <ol aria-label={item.title} className="ml-5 mt-1 space-y-1.5">
          {item.steps.map((step) => {
            const status = step.status === "running" && !turnActive ? "unfinished" : step.status;
            return (
              <li key={step.id} className="flex items-start gap-2">
                {status === "done" ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-success" />
                ) : status === "running" ? (
                  <Loader2
                    size={13}
                    className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                  />
                ) : status === "failed" || status === "unfinished" ? (
                  <X size={13} className="mt-0.5 shrink-0 text-danger" />
                ) : (
                  <Circle size={13} className="mt-0.5 shrink-0" />
                )}
                <span className="min-w-0 break-words">
                  {step.title}
                  <span className={status === "unfinished" ? "ml-2" : "sr-only"}>
                    {planStepLabels[status]}
                  </span>
                  {step.detail ? <span className="ml-2">{step.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
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
