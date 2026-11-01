import type {
  ApprovalItem,
  ArtifactItem,
  ErrorItem,
  MessageItem,
  PlanItem,
  TimelineItem,
  ToolItem,
} from "@larness/shared";
import { Button, cn } from "@larness/ui";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  Globe2,
  ListChecks,
  Loader2,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wrench,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { MarkdownText } from "@/features/chat/MarkdownText";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { useWindowStore } from "@/stores/windowStore";

export function TimelineItemView({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "message":
      return <MessageBubble item={item} />;
    case "plan":
      return <PlanCard item={item} />;
    case "tool":
      return <ToolCard item={item} />;
    case "approval":
      return <ApprovalCard item={item} />;
    case "artifact":
      return <ArtifactCard item={item} />;
    case "error":
      return <ErrorCard item={item} />;
    default:
      return null;
  }
}

function MessageBubble({ item }: { item: MessageItem }) {
  const assistant = item.role === "assistant";
  return (
    <div className={cn("flex gap-2.5", assistant ? "justify-start" : "justify-end")}>
      {assistant ? (
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-gradient-to-br from-[#3d9bff] to-[#0066d6] text-[10px] font-bold text-white shadow-sm">
          L
        </div>
      ) : null}
      <div
        className={cn(
          "max-w-[78%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-[1.6]",
          assistant
            ? "rounded-tl-md border border-line bg-surface text-ink shadow-[var(--shadow-card)]"
            : "rounded-tr-md bg-accent text-white shadow-[0_2px_10px_rgba(10,132,255,.18)]",
        )}
      >
        {assistant ? (
          <div className={cn(item.streaming && "streaming-cursor")}>
            <MarkdownText text={item.text} />
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{item.text}</div>
        )}
      </div>
    </div>
  );
}

function PlanCard({ item }: { item: PlanItem }) {
  const done = item.steps.filter((step) => step.status === "done").length;
  const percent = Math.round((done / Math.max(1, item.steps.length)) * 100);
  return (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <ListChecks size={13} />
        </span>
        <span className="text-[12px] font-semibold text-ink">{item.title}</span>
        <span className="ml-auto font-mono text-[10px] text-ink-3">
          {done}/{item.steps.length}
        </span>
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-2.5 space-y-1.5">
        {item.steps.map((step) => (
          <div key={step.id} className="flex items-start gap-2 text-[11.5px]">
            <span className="mt-[1px] shrink-0">
              {step.status === "done" ? (
                <CheckCircle2 size={13} className="text-success" />
              ) : step.status === "running" ? (
                <Loader2 size={13} className="animate-spin text-accent" />
              ) : step.status === "failed" ? (
                <XCircle size={13} className="text-danger" />
              ) : (
                <Circle size={13} className="text-ink-3/60" />
              )}
            </span>
            <span className="min-w-0 flex-1 text-ink-2">{step.title}</span>
            {step.detail ? (
              <span className="shrink-0 text-[10px] text-ink-3">{step.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCard({ item }: { item: ToolItem }) {
  const [expanded, setExpanded] = useState(false);
  const tone =
    item.status === "running"
      ? "text-accent"
      : item.status === "error"
        ? "text-danger"
        : "text-ink-3";

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2/55">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-md border border-line bg-surface">
          <Wrench size={11.5} className={tone} />
        </span>
        <span className="font-mono text-[11px] font-medium text-ink">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-2">{item.summary}</span>
        {item.status === "running" ? (
          <Loader2 size={12} className="animate-spin text-accent" />
        ) : item.status === "error" ? (
          <XCircle size={12} className="text-danger" />
        ) : (
          <Check size={12} className="text-success" />
        )}
        {typeof item.durationMs === "number" ? (
          <span className="flex items-center gap-0.5 font-mono text-[9.5px] text-ink-3">
            <Clock3 size={9} />
            {item.durationMs}ms
          </span>
        ) : null}
        <ChevronDown
          size={12}
          className={cn("shrink-0 text-ink-3 transition-transform", expanded && "rotate-180")}
        />
      </button>
      {expanded ? (
        <div className="space-y-2 border-t border-line/80 px-3 py-2.5">
          <div>
            <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[.08em] text-ink-3">
              arguments
            </div>
            <pre className="max-h-32 overflow-auto rounded-lg bg-[#1d1d1f] px-2.5 py-2 font-mono text-[10px] leading-4 text-[#d7dae0]">
              {item.args}
            </pre>
          </div>
          {item.output ? (
            <div>
              <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[.08em] text-ink-3">
                result
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-[#1d1d1f] px-2.5 py-2 font-mono text-[10px] leading-4 text-[#d7dae0]">
                {item.output}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ApprovalCard({ item }: { item: ApprovalItem }) {
  const resolve = useTimelineStore((state) => state.resolveApproval);
  const pending = item.status === "pending";
  const toolApproval = item.toolName !== undefined || item.summary !== undefined;
  const expires = item.expiresAt === undefined ? null : new Date(item.expiresAt);
  const expiryLabel =
    expires === null ? "—" : expires.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={cn(
        "rounded-xl border p-3.5",
        item.status === "approved"
          ? "border-success/25 bg-success/[.055]"
          : item.status === "rejected"
            ? "border-line bg-surface-2/60"
            : "border-warning/30 bg-warning/[.055]",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-lg",
            item.status === "approved"
              ? "bg-success/15 text-success"
              : item.status === "rejected"
                ? "bg-black/[.05] text-ink-3 dark:bg-white/[.07]"
                : "bg-warning/15 text-warning",
          )}
        >
          {item.status === "approved" ? (
            <ShieldCheck size={14} />
          ) : item.status === "rejected" ? (
            <ShieldX size={14} />
          ) : (
            <ShieldAlert size={14} />
          )}
        </span>
        <span className="text-[12px] font-semibold text-ink">
          {toolApproval ? "工具审批" : "部署审批"}
        </span>
        <span className="ml-auto rounded-full border border-line bg-surface px-2 py-[1px] text-[9.5px] font-medium text-ink-2">
          {item.status === "approved"
            ? "已批准"
            : item.status === "rejected"
              ? "已拒绝"
              : "等待批准"}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-2 rounded-lg border border-line/80 bg-surface/70 p-2.5">
        <Metric
          label={toolApproval ? "工具" : "服务"}
          value={toolApproval ? (item.toolName ?? "tool") : (item.serviceName ?? "—")}
          mono
        />
        <Metric
          label={toolApproval ? "风险" : "端口"}
          value={toolApproval ? (item.risk ?? "L1") : String(item.port ?? "—")}
          mono
        />
        <Metric
          label={toolApproval ? "过期" : "版本"}
          value={toolApproval ? expiryLabel : (item.version ?? "—")}
          mono
        />
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-2">
        {toolApproval
          ? (item.summary ?? "Agent 请求执行受控工具，需要你的确认。")
          : (item.impact ?? "批准后才会替换生产服务。")}
      </p>

      {pending ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button variant="primary" size="sm" onClick={() => void resolve(item.id, "approve")}>
            {toolApproval ? "批准执行" : "批准部署"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void resolve(item.id, "reject")}>
            {toolApproval ? "拒绝" : "暂不部署"}
          </Button>
          <span className="ml-auto text-[9.5px] text-ink-3">
            {toolApproval ? "参数绑定，批准后仅执行一次" : "批准后才会替换生产服务"}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactCard({ item }: { item: ArtifactItem }) {
  const open = useWindowStore((state) => state.open);
  const projectId = useNavigationStore((state) => state.projectId);
  const sessionId = useNavigationStore((state) => state.sessionId);
  const deploy = item.title.includes("部署");

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 shadow-[var(--shadow-card)]">
      <div className="flex h-11 w-14 items-center justify-center rounded-lg bg-gradient-to-br from-[#0a84ff]/15 to-[#0066d6]/5 text-accent">
        {deploy ? <Rocket size={18} /> : <Globe2 size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11.5px] font-semibold text-ink">{item.title}</div>
        <div className="truncate text-[10.5px] text-ink-2">{item.description}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-ink-3">{item.meta}</div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        leading={<ExternalLink size={11} />}
        onClick={() =>
          open({
            kind: "browser",
            resourceId: item.href ?? "browser_preview",
            title: item.meta,
            projectId,
            sessionId,
            source: "artifact",
          })
        }
      >
        打开
      </Button>
    </div>
  );
}

function ErrorCard({ item }: { item: ErrorItem }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger/[.055] px-3 py-2.5 text-[11.5px] text-ink-2">
      <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
      <span>{item.message}</span>
    </div>
  );
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[.08em] text-ink-3">{label}</div>
      <div className={cn("mt-0.5 truncate text-[10.5px] text-ink-2", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}

export function TimelineSection({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3">{children}</div>;
}
