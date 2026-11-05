import type { ArtifactItem, MessageItem, PlanItem, TimelineItem, ToolItem } from "@larness/shared";
import { cn } from "@larness/ui";
import { Check, ChevronRight, Circle, Copy, Loader2, X } from "lucide-react";
import { useState } from "react";
import { FileResultCard } from "@/features/files/FileResultCard";
import { PreviewResultCard } from "@/features/services/PreviewResultCard";
import { TerminalResultCard } from "@/features/terminals/TerminalResultCard";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore } from "@/stores/windowStore";
import { MarkdownText } from "./MarkdownText";

export function TimelineItemView({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return <MessageBubble item={item} />;
    case "plan":
      return <PlanCard item={item} />;
    case "tool":
      return <ToolCard item={item} />;
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
        </div>
      );
  }
}

function MessageBubble({ item }: { item: MessageItem }) {
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
    <article className="min-w-0 break-words text-[13px] leading-[1.65] text-ink [overflow-wrap:anywhere]">
      <div className="w-fit min-w-0 max-w-full rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5 shadow-[var(--shadow-card)]">
        <MarkdownText text={item.text} />
      </div>
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

function PlanCard({ item }: { item: PlanItem }) {
  const [expanded, setExpanded] = useState(false);
  const done = item.steps.filter((step) => step.status === "done").length;
  const current = item.steps.find((step) => step.status === "running");
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
          {item.steps.map((step) => (
            <li key={step.id} className="flex items-start gap-2">
              {step.status === "done" ? (
                <Check size={13} className="mt-0.5 shrink-0 text-success" />
              ) : step.status === "running" ? (
                <Loader2
                  size={13}
                  className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                />
              ) : step.status === "failed" ? (
                <X size={13} className="mt-0.5 shrink-0 text-danger" />
              ) : (
                <Circle size={13} className="mt-0.5 shrink-0" />
              )}
              <span className="min-w-0 break-words">
                <span className="sr-only">
                  {step.status === "done"
                    ? "已完成："
                    : step.status === "running"
                      ? "进行中："
                      : step.status === "failed"
                        ? "失败："
                        : "待做："}
                </span>
                {step.title}
                {step.detail ? <span className="ml-2">{step.detail}</span> : null}
              </span>
            </li>
          ))}
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
        <span className="min-w-0 break-words">{item.summary || item.name}</span>
        {item.status === "error" ? <X size={13} className="mt-0.5 shrink-0 text-danger" /> : null}
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
