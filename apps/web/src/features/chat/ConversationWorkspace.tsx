import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, PanelRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { Composer } from "@/features/chat/Composer";
import { RenameSessionDialog } from "@/features/chat/RenameSessionDialog";
import { Timeline } from "@/features/chat/Timeline";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { archiveSession } from "@/lib/workspaceApi";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

export function ConversationWorkspace() {
  const { data } = useSnapshot();
  const { projectId, sessionId } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);

  const session = [...(USE_MOCKS ? extra : []), ...data.sessions].find(
    (item) => item.id === sessionId,
  );
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const running = isStreaming || session?.status === "running";

  const archive = async (): Promise<void> => {
    if (!session || USE_MOCKS) return;

    try {
      await archiveSession(session.id);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "归档会话失败";
      window.dispatchEvent(new CustomEvent("larness:workspace-error", { detail: message }));
    }
  };

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="会话操作">
                <MoreHorizontal size={15} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[190px]">
              <DropdownMenuItem disabled={!session} onSelect={() => setRenameOpen(true)}>
                重命名会话
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!session || USE_MOCKS}
                onSelect={() => void archive()}
                className="text-danger focus:text-danger"
              >
                归档会话
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Timeline />

      <RenameSessionDialog
        session={session ? { id: session.id, title: session.title } : null}
        onClose={() => setRenameOpen(false)}
        open={renameOpen}
      />

      <div data-testid="composer-dock" className="relative shrink-0 px-4 pb-4 pt-2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -top-5 h-5 bg-gradient-to-t from-canvas via-canvas/70 to-transparent"
        />
        <div className="relative mx-auto w-full max-w-[880px]">
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
