import { useEffect } from "react";
import { ProjectResourceSidebar } from "@/components/layout/ProjectResourceSidebar";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarResizeHandle } from "@/components/layout/SidebarResizeHandle";
import { TopBar } from "@/components/layout/TopBar";
import { WindowLayer } from "@/components/windows/WindowLayer";
import { ConversationWorkspace } from "@/features/chat/ConversationWorkspace";
import { useNewSession } from "@/lib/useNewSession";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { useWindowStore } from "@/stores/windowStore";

export function AppShell() {
  const sessionId = useNavigationStore((state) => state.sessionId);
  const sidebarCollapsed = useNavigationStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useNavigationStore((state) => state.sidebarWidth);
  const resourceWidth = useNavigationStore((state) => state.resourceWidth);
  const setSidebarWidth = useNavigationStore((state) => state.setSidebarWidth);
  const setResourceWidth = useNavigationStore((state) => state.setResourceWidth);
  const mobileSidebarOpen = useNavigationStore((state) => state.mobileSidebarOpen);
  const toggleSidebar = useNavigationStore((state) => state.toggleSidebar);
  const setMobileSidebar = useNavigationStore((state) => state.setMobileSidebar);
  const newSession = useNewSession();

  useEffect(() => {
    void useTimelineStore.getState().load(sessionId);
  }, [sessionId]);

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
        const top = state.windows.filter((win) => !win.minimized).sort((a, b) => b.z - a.z)[0];
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
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-ink">
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
        <WindowLayer />
      </div>

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
