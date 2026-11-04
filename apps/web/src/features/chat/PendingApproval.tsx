import type { ApprovalItem } from "@larness/shared";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { pendingApprovals } from "@/lib/pendingApprovals";
import { useSnapshot } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

export function PendingApproval() {
  const items = useTimelineStore((state) => state.items);
  const sessionId = useTimelineStore((state) => state.sessionId);
  const pending = pendingApprovals(items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const index = Math.max(
    0,
    pending.findIndex((item) => item.id === selectedId),
  );
  const item = pending[index];
  if (!item) return null;
  return (
    <ApprovalPanel
      key={`${sessionId}:${item.id}`}
      item={item}
      index={index}
      total={pending.length}
      navigate={(offset) => setSelectedId(pending[index + offset]?.id ?? item.id)}
    />
  );
}

function ApprovalPanel({
  item,
  index,
  total,
  navigate,
}: {
  item: ApprovalItem;
  index: number;
  total: number;
  navigate: (offset: number) => void;
}) {
  const resolve = useTimelineStore((state) => state.resolveApproval);
  const { data } = useSnapshot();
  const projectId = useNavigationStore((state) => state.projectId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = item.expiresAt !== undefined && now >= item.expiresAt;
  const decide = async (decision: "approve" | "reject") => {
    if (busy || expired) return;
    setBusy(true);
    setError(null);
    try {
      await resolve(item.id, decision);
    } catch (error) {
      setError(error instanceof Error ? error.message : "审批提交失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      aria-label="待处理审批"
      className="mb-2.5 max-h-[min(42dvh,360px)] overflow-y-auto rounded-xl border border-line bg-surface-2 p-3 text-[12px]"
    >
      <div className="mb-2 flex items-center gap-2 font-medium text-ink">
        <ShieldCheck size={14} />
        <span>需要批准</span>
        {total > 1 ? (
          <div className="ml-auto flex items-center gap-2 text-ink-3">
            <button
              type="button"
              aria-label="上一项审批"
              disabled={busy || index === 0}
              onClick={() => navigate(-1)}
              className="rounded p-1 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {index + 1}/{total}
            </span>
            <button
              type="button"
              aria-label="下一项审批"
              disabled={busy || index === total - 1}
              onClick={() => navigate(1)}
              className="rounded p-1 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="mb-2 text-[11px] text-ink-3">
        {data.projects.find((project) => project.id === projectId)?.name ?? "默认工作区"} ·{" "}
        {item.toolName ?? item.serviceName ?? "操作"}
      </div>
      <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface px-2.5 py-2 font-mono text-[12px] text-ink">
        {item.summary ?? item.impact ?? "请求执行操作"}
      </pre>
      <details className="mt-2 text-[11px] text-ink-3">
        <summary className="cursor-pointer">查看操作详情</summary>
        <div className="mt-2 space-y-1 whitespace-pre-wrap break-words">
          <div>授权范围：仅本次操作 · 风险 {item.risk ?? "—"}</div>
          {item.expiresAt !== undefined ? (
            <div>有效至 {new Date(item.expiresAt).toLocaleTimeString()}</div>
          ) : null}
          <pre className="max-h-28 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(item.scope ?? {}, null, 2)}
          </pre>
        </div>
      </details>
      {expired ? (
        <p role="status" className="mt-2 text-ink-3">
          审批已过期，等待任务更新。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 break-words text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          aria-label={item.toolName ? "批准执行" : "批准部署"}
          disabled={busy || expired}
          onClick={() => void decide("approve")}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] text-surface disabled:opacity-40"
        >
          {busy ? "提交中…" : "批准本次"}
        </button>
        <button
          type="button"
          disabled={busy || expired}
          onClick={() => void decide("reject")}
          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-ink disabled:opacity-40"
        >
          拒绝
        </button>
      </div>
    </section>
  );
}
