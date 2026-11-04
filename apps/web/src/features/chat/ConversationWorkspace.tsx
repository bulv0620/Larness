import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, PanelRight } from "lucide-react";
import { useState } from "react";
import { ResourceDock } from "@/components/windows/ResourceDock";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { archiveSession } from "@/lib/workspaceApi";
import { unassignedWorkspaceLabel } from "@/lib/workspaceScope";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { Composer } from "./Composer";
import { PendingApproval } from "./PendingApproval";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { Timeline } from "./Timeline";

export function ConversationWorkspace() {
  const { data } = useSnapshot();
  const { projectId, sessionId, resourceCollapsed, toggleResource } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const client = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const session = [...(USE_MOCKS ? extra : []), ...data.sessions].find(
    (item) => item.id === sessionId,
  );
  const project = data.projects.find((item) => item.id === projectId);
  const archive = async () => {
    if (!session || USE_MOCKS) return;
    try {
      await archiveSession(session.id);
      await client.invalidateQueries({ queryKey: ["workspace"] });
    } catch (error) {
      window.dispatchEvent(
        new CustomEvent("larness:workspace-error", {
          detail: error instanceof Error ? error.message : "归档会话失败",
        }),
      );
    }
  };
  return (
    <main className="conversation-surface flex min-h-0 min-w-0 flex-1 flex-col bg-canvas/55">
      <header className="flex h-12 shrink-0 items-center gap-3 px-4 sm:px-7">
        <h1 className="min-w-0 truncate text-[12px] font-medium">{session?.title ?? "新会话"}</h1>
        <span className="ml-auto hidden max-w-[40%] truncate text-[11px] text-ink-3 md:block">
          {project?.name ?? unassignedWorkspaceLabel(sessionId, data.sessions)}
        </span>
        <div className="ml-auto flex items-center gap-0.5 md:ml-0">
          <IconButton
            label={resourceCollapsed ? "展开项目资源" : "折叠项目资源"}
            className="hidden xl:inline-flex"
            onClick={toggleResource}
          >
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
      </header>
      <Timeline />
      <RenameSessionDialog
        session={session ? { id: session.id, title: session.title } : null}
        onClose={() => setRenameOpen(false)}
        open={renameOpen}
      />
      <div data-testid="composer-dock" className="relative shrink-0 px-4 pb-3 pt-1 sm:px-7">
        <div className="relative mx-auto w-full max-w-[760px]">
          <ResourceDock />
          <PendingApproval />
          <Composer />
        </div>
      </div>
    </main>
  );
}
