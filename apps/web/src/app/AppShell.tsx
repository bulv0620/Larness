import type { GatewaySnapshot } from "@larness/shared";
import { cn, ErrorMessage } from "@larness/ui";
import { useEffect, useState } from "react";
import { CollapsibleSidebar } from "@/components/layout/CollapsibleSidebar";
import { ProjectResourceSidebar } from "@/components/layout/ProjectResourceSidebar";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { SidebarResizeHandle } from "@/components/layout/SidebarResizeHandle";
import { TopBar } from "@/components/layout/TopBar";
import { WindowLayer } from "@/components/windows/WindowLayer";
import { ConversationWorkspace } from "@/features/chat/ConversationWorkspace";
import { useSessionEvents } from "@/features/chat/useSessionEvents";
import { USE_MOCKS } from "@/lib/env";
import { queryClient, useSnapshot } from "@/lib/queries";
import { useNewSession } from "@/lib/useNewSession";
import { activeWindowScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore, windowScopeKey } from "@/stores/windowStore";

const useAnimatedPresence = (
  open: boolean,
  closeDelayMs = 220,
): { mounted: boolean; visible: boolean } => {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), closeDelayMs);
    return () => window.clearTimeout(timer);
  }, [open, closeDelayMs]);

  return { mounted, visible };
};

export function AppShell({ version }: { version?: string }) {
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
  const mobileDrawer = useAnimatedPresence(mobileSidebarOpen);

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
        const sessions = queryClient.getQueryData<GatewaySnapshot>(["workspace"])?.sessions ?? [];
        const scope = activeWindowScope(nav.projectId, nav.sessionId, sessions);
        const top = state.windows
          .filter((win) => !win.minimized && windowScopeKey(win) === scope)
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
      <TopBar version={version} />
      <div className="relative flex min-h-0 flex-1">
        <CollapsibleSidebar
          collapsed={sidebarCollapsed}
          side="left"
          width={sidebarWidth}
          className="hidden md:flex"
        >
          <ProjectSidebar />
        </CollapsibleSidebar>
        <SidebarResizeHandle
          side="left"
          label="调整项目侧栏宽度"
          value={sidebarWidth}
          min={220}
          max={360}
          defaultValue={268}
          onChange={setSidebarWidth}
          collapsed={sidebarCollapsed}
          className="hidden md:block"
        />
        <ConversationWorkspace />
        <SidebarResizeHandle
          side="right"
          label="调整资源侧栏宽度"
          value={resourceWidth}
          min={280}
          max={460}
          defaultValue={340}
          onChange={setResourceWidth}
          collapsed={resourceCollapsed}
          className="hidden xl:block"
        />
        <CollapsibleSidebar
          collapsed={resourceCollapsed}
          side="right"
          width={resourceWidth}
          className="hidden xl:flex"
        >
          <ProjectResourceSidebar />
        </CollapsibleSidebar>
        <WindowLayer />
      </div>

      <ErrorMessage message={workspaceError} onDismiss={() => setWorkspaceError(null)} />

      {mobileDrawer.mounted ? (
        <div className="fixed inset-0 z-[150] md:hidden">
          <button
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileSidebar(false)}
            className={cn(
              "absolute inset-0 bg-black/30 backdrop-blur-[2px] transition-opacity duration-200",
              mobileDrawer.visible ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
          <div
            className={cn(
              "absolute inset-y-0 left-0 w-[280px] shadow-[var(--shadow-window)] transition-transform duration-200 ease-out",
              mobileDrawer.visible ? "translate-x-0" : "pointer-events-none -translate-x-full",
            )}
          >
            <ProjectSidebar mobile />
          </div>
        </div>
      ) : null}
    </div>
  );
}
