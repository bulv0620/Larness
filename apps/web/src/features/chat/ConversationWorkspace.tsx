import { cn, IconButton } from "@harness/ui";
import { MoreHorizontal, PanelRight, Sparkles } from "lucide-react";
import { StatusDot } from "@/components/common/StatusDot";
import { Composer } from "@/features/chat/Composer";
import { Timeline } from "@/features/chat/Timeline";
import { useSnapshot } from "@/lib/queries";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

export function ConversationWorkspace() {
  const { data } = useSnapshot();
  const { projectId, sessionId } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const isStreaming = useTimelineStore((state) => state.isStreaming);

  const session = [...extra, ...data.sessions].find((item) => item.id === sessionId);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const running = isStreaming || session?.status === "running";

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-canvas/55">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[13.5px] font-semibold tracking-[-.01em]">
            {session?.title ?? "新会话"}
          </h1>
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-[2px] text-[10px] font-medium",
              running
                ? "border-success/20 bg-success/10 text-success"
                : "border-line bg-surface-2 text-ink-3",
            )}
          >
            <StatusDot tone={running ? "running" : "idle"} pulse={running} />
            {running ? "运行中" : "空闲"}
          </span>
        </div>
        <span className="hidden min-w-0 items-center gap-1.5 truncate font-mono text-[10px] text-ink-3 md:flex">
          <span className="text-ink-3/60">›</span>
          {project?.rootPath ?? "独立会话工作目录"}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton label="会话操作">
            <PanelRight size={14} />
          </IconButton>
          <IconButton label="更多">
            <MoreHorizontal size={15} />
          </IconButton>
        </div>
      </div>

      <Timeline />

      <div className="shrink-0 border-t border-line/70 bg-canvas/70 px-4 pb-4 pt-3 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[880px]">
          <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[10.5px] text-ink-3">
            <Sparkles size={11.5} className="text-accent" />
            <span className="font-medium text-ink-2">项目上下文</span>
            <span>·</span>
            <span>{project?.name ?? "独立会话"}</span>
            <span>·</span>
            <span className="font-mono">{project?.branch ?? "workspace"}</span>
          </div>
          <Composer />
          <div className="mt-2 flex items-center px-1 text-[9.5px] text-ink-3">
            <span>Agent 可能执行工具与命令，请在批准前确认影响。</span>
            <span className="ml-auto hidden items-center gap-1 sm:flex">
              <span className="font-mono">Enter</span> 发送
              <span className="mx-1 text-ink-3/50">·</span>
              <span className="font-mono">Shift + Enter</span> 换行
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
