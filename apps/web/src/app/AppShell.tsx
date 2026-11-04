import { useEffect, useState } from "react";
import { ProjectResourceSidebar } from "@/components/layout/ProjectResourceSidebar";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarResizeHandle } from "@/components/layout/SidebarResizeHandle";
import { TopBar } from "@/components/layout/TopBar";
import { WindowLayer } from "@/components/windows/WindowLayer";
import { ConversationWorkspace } from "@/features/chat/ConversationWorkspace";
import { useSessionEvents } from "@/features/chat/useSessionEvents";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useNewSession } from "@/lib/useNewSession";
import { useNavigationStore } from "@/stores/navigationStore";
import { resourceScopeKey, useWindowStore, windowScopeKey } from "@/stores/windowStore";

export function AppShell() {
  const { data, isPending, isError } = useSnapshot();
  const sessionId = useNavigationStore((state) => state.sessionId);
  const reconcileWorkspace = useNavigationStore((state) => state.reconcileWorkspace);
  const sidebarCollapsed = useNavigationStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useNavigationStore((state) => state.sidebarWidth);
  const resourceWidth = useNavigationStore((state) => state.resourceWidth);
  const resourceCollapsed = useNavigationStore((state) => state.resourceCollapsed);
  const setSidebarWidth = useNavigationStore((state) => state.setSidebarWidth);
  const setResourceWidth = useNavigationStore((state) => state.setResourceWidth);
  const mobileSidebarOpen = useNavigationStore((state) => state.mobileSidebarOpen);
  const toggleSidebar = useNavigationStore((state) => state.toggleSidebar);
  const setMobileSidebar = useNavigationStore((state) => state.setMobileSidebar);
  const newSession = useNewSession();
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  useSessionEvents(sessionId);

  useEffect(() => {
    const onError = (event: Event): void => {
      const detail = (event as CustomEvent<string>).detail;
      setWorkspaceError(typeof detail === "string" ? detail : "操作失败");
    };

    window.addEventListener("larness:workspace-error", onError);
    return () => window.removeEventListener("larness:workspace-error", onError);
  }, []);

  useEffect(() => {
    if (USE_MOCKS || isPending || isError) return;
    reconcileWorkspace(
      data.projects.map((project) => project.id),
      data.sessions,
    );
  }, [data.projects, data.sessions, isPending, isError, reconcileWorkspace]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (modifier && key === "k") {
        event.preventDefault();
        newSession();
        return;
      }

      if (modifier && key === "b") {
        event.preventDefault();
        toggleSidebar();
        return;
      }

      if (event.key === "Escape" && !modifier) {
        const state = useWindowStore.getState();
        const nav = useNavigationStore.getState();
        const scope = resourceScopeKey(nav.projectId, nav.projectId ? null : nav.sessionId);
        const top = state.windows
          .filter(
            (win) =>
              !win.minimized &&
              (windowScopeKey(win) === scope ||
                (!nav.projectId && windowScopeKey(win) === "global")),
          )
          .sort((a, b) => b.z - a.z)[0];
        if (top) {
          event.preventDefault();
          state.hide(top.id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newSession, toggleSidebar]);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-canvas text-ink"
      data-testid="workspace-home"
    >
      <TopBar />
      <div className="relative flex min-h-0 flex-1">
        {!sidebarCollapsed ? <ProjectSidebar /> : null}
        {!sidebarCollapsed ? (
          <SidebarResizeHandle
            side="left"
            label="调整项目侧栏宽度"
            value={sidebarWidth}
            min={220}
            max={360}
            defaultValue={268}
            onChange={setSidebarWidth}
            className="hidden md:block"
          />
        ) : null}
        <ConversationWorkspace />
        {!resourceCollapsed ? (
          <>
            <SidebarResizeHandle
              side="right"
              label="调整资源侧栏宽度"
              value={resourceWidth}
              min={280}
              max={460}
              defaultValue={340}
              onChange={setResourceWidth}
              className="hidden xl:block"
            />
            <ProjectResourceSidebar />
          </>
        ) : null}
        <WindowLayer />
      </div>

      {workspaceError ? (
        <div className="fixed bottom-4 left-1/2 z-[200] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-danger/25 bg-surface px-3 py-2 text-[11.5px] text-danger shadow-[var(--shadow-pop)]">
          <span>{workspaceError}</span>
          <button
            type="button"
            className="text-ink-3 hover:text-ink"
            onClick={() => setWorkspaceError(null)}
          >
            关闭
          </button>
        </div>
      ) : null}

      {mobileSidebarOpen ? (
        <div className="fixed inset-0 z-[150] md:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileSidebar(false)}
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
          />
          <div className="absolute inset-y-0 left-0 w-[280px] shadow-[var(--shadow-window)]">
            <ProjectSidebar mobile />
          </div>
        </div>
      ) : null}
    </div>
  );
}
