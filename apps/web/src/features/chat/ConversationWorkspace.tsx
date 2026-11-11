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
import { MoreHorizontal, PanelRight } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ResourceDock } from "@/components/windows/ResourceDock";
import { operationError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { archiveSession } from "@/lib/workspaceApi";
import { unassignedWorkspaceLabel } from "@/lib/workspaceScope";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";
import { PendingApproval } from "./PendingApproval";
import { RenameSessionDialog } from "./RenameSessionDialog";
import { Timeline } from "./Timeline";
import { WelcomeHeading, WelcomeSuggestions } from "./Welcome";

export function ConversationWorkspace() {
  const { data } = useSnapshot();
  const { projectId, sessionId, resourceCollapsed, toggleResource } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const client = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const centered = useTimelineStore(
    (state) =>
      state.sessionId === sessionId && !state.loading && !state.isStreaming && !state.items.length,
  );
  const composerRef = useRef<HTMLDivElement>(null);
  const departure = useRef<{ sessionId: string; top: number } | null>(null);
  const movement = useRef<Animation | null>(null);

  const captureComposerPosition = () => {
    if (
      centered &&
      composerRef.current &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      departure.current = { sessionId, top: composerRef.current.getBoundingClientRect().top };
    }
  };

  useLayoutEffect(() => {
    if (centered) {
      movement.current?.cancel();
      return;
    }
    const origin = departure.current;
    departure.current = null;
    const composer = composerRef.current;
    if (origin?.sessionId !== sessionId || !composer || typeof composer.animate !== "function")
      return;
    const offset = origin.top - composer.getBoundingClientRect().top;
    if (offset) {
      movement.current = composer.animate(
        [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
        { duration: 290, easing: "cubic-bezier(.22,.75,.25,1)" },
      );
    }
  }, [centered, sessionId]);
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
          detail: operationError(error, "归档会话失败"),
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
      {centered ? null : <Timeline />}
      <RenameSessionDialog
        session={session ? { id: session.id, title: session.title } : null}
        onClose={() => setRenameOpen(false)}
        open={renameOpen}
      />
      <div
        data-testid="composer-dock"
        data-placement={centered ? "center" : "bottom"}
        className={cn(
          "relative px-4 sm:px-7",
          centered ? "flex min-h-0 flex-1 flex-col overflow-y-auto py-5" : "shrink-0 pb-3 pt-1",
        )}
      >
        <div
          className={cn(
            "relative mx-auto flex w-full max-w-[760px] flex-col",
            centered && "my-auto shrink-0",
          )}
        >
          {centered ? <WelcomeHeading /> : null}
          {centered ? null : <ResourceDock />}
          <PendingApproval />
          <div ref={composerRef} data-composer-motion className="relative z-10 min-w-0">
            <Composer centered={centered} onSubmit={captureComposerPosition} />
          </div>
          {centered ? (
            <>
              <WelcomeSuggestions />
              <div className="mt-5">
                <ResourceDock />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
