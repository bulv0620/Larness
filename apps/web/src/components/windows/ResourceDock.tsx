import { cn } from "@larness/ui";
import { FileCode2, GitCompare, Globe2, Server, SquareTerminal } from "lucide-react";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import type { WindowKind } from "@/lib/windowTypes";
import { activeWindowScope, activeWorkspaceScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore, windowScopeKey } from "@/stores/windowStore";

const icons = {
  files: FileCode2,
  terminal: SquareTerminal,
  services: Server,
  browser: Globe2,
  "git-diff": GitCompare,
};
export function ResourceDock() {
  const { data } = useSnapshot();
  const { projectId, sessionId } = useNavigationStore();
  const { windows, focusedId, open, restore } = useWindowStore();
  const scope = activeWindowScope(projectId, sessionId, data.sessions);
  const workspace = activeWorkspaceScope(projectId, sessionId, data.sessions);
  const current = windows.filter((win) => windowScopeKey(win) === scope);
  const launch = (kind: "terminal" | "services") => {
    const existing = current.find((win) => win.tabs[0]?.kind === kind);
    if (existing) {
      restore(existing.id);
      return;
    }
    const terminal = data.terminals.find((item) => item.projectId === projectId);
    const service = data.services.find((item) => item.projectId === projectId);
    open({
      kind,
      resourceId: USE_MOCKS
        ? kind === "terminal"
          ? (terminal?.id ?? "terminal:empty")
          : (service?.id ?? "services:empty")
        : `${kind}:empty`,
      title: USE_MOCKS
        ? kind === "terminal"
          ? (terminal?.title ?? "终端")
          : (service?.name ?? "服务")
        : kind === "terminal"
          ? "终端"
          : "服务",
      projectId,
      sessionId: "sessionId" in workspace ? workspace.sessionId : null,
      source: projectId ? "project" : "session",
    });
  };
  return (
    <div className="pointer-events-none relative z-[60] mb-3 flex justify-center px-1">
      <nav
        aria-label="项目窗口"
        className="window-tabs-scroll pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-surface/90 p-1.5 shadow-[0_5px_22px_rgba(0,0,0,.08),0_1px_3px_rgba(0,0,0,.04)] backdrop-blur-xl"
      >
        {(["terminal", "services"] as const).map((kind) => {
          const Icon = icons[kind];
          const win = current.find((item) => item.tabs[0]?.kind === kind);
          const active = win && !win.minimized && win.id === focusedId;
          return (
            <button
              key={kind}
              type="button"
              aria-label={kind === "terminal" ? "打开终端窗口" : "打开服务窗口"}
              aria-pressed={!!active}
              onClick={() => launch(kind)}
              className={cn(
                "flex h-8 shrink-0 items-center gap-2 rounded-xl px-3 text-[11px] font-medium transition-colors",
                active
                  ? "bg-accent-soft text-accent"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon size={14} strokeWidth={1.7} />
              {kind === "terminal" ? "终端" : "服务"}
              {win && win.tabs.filter((tab) => !tab.resourceId.endsWith(":empty")).length > 0 ? (
                <span className="rounded bg-black/[.045] px-1 font-mono text-[9px] dark:bg-white/[.08]">
                  {win.tabs.filter((tab) => !tab.resourceId.endsWith(":empty")).length}
                </span>
              ) : null}
            </button>
          );
        })}
        {current
          .filter(
            (win) => win.minimized && !["terminal", "services"].includes(win.tabs[0]?.kind ?? ""),
          )
          .map((win) => {
            const tab = win.tabs.find((item) => item.id === win.activeTabId) ?? win.tabs[0];
            if (!tab) return null;
            const Icon = icons[tab.kind as WindowKind];
            return (
              <button
                key={win.id}
                type="button"
                aria-label={`恢复 ${tab.title}`}
                onClick={() => restore(win.id)}
                title={tab.title}
                className="flex h-8 max-w-44 shrink-0 items-center gap-2 rounded-xl border-l border-line px-3 text-[11px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{tab.title}</span>
                {win.tabs.length > 1 ? (
                  <span className="text-[9px] text-ink-3">{win.tabs.length}</span>
                ) : null}
              </button>
            );
          })}
      </nav>
    </div>
  );
}
