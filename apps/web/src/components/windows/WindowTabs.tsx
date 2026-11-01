import { cn } from "@larness/ui";
import { FileCode2, FolderTree, GitCompare, Globe2, Server, SquareTerminal, X } from "lucide-react";
import { useSnapshot } from "@/lib/queries";
import { filterFromValue, filterTabs, filterValue } from "@/lib/windowFilters";
import type { ManagedWindow, WindowKind } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";

function TabIcon({ kind }: { kind: WindowKind }) {
  const Icon =
    kind === "terminal"
      ? SquareTerminal
      : kind === "services"
        ? Server
        : kind === "browser"
          ? Globe2
          : kind === "git-diff"
            ? GitCompare
            : FileCode2;
  return <Icon size={11.5} className="shrink-0 text-ink-3" />;
}

function projectLabel(projectId: string | null, originType: string, name?: string): string {
  if (projectId) return name ?? projectId;
  if (originType === "session") return "独立会话";
  return "全局";
}

export function WindowTabs({ window: win }: { window: ManagedWindow }) {
  const setActiveTab = useWindowStore((state) => state.setActiveTab);
  const closeTab = useWindowStore((state) => state.closeTab);
  const setFilter = useWindowStore((state) => state.setFilter);
  const { data } = useSnapshot();
  const visible = filterTabs(win.tabs, win.filter);
  const kind = win.tabs[0]?.kind;
  const supportsFilter = kind !== undefined && kind !== "git-diff";
  const showProjectPrefix =
    win.filter.mode === "all" && new Set(visible.map((tab) => tab.projectId)).size > 1;

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-line bg-surface-2/35">
      {supportsFilter ? (
        <div className="flex shrink-0 items-center gap-1.5 border-r border-line px-2">
          <FolderTree size={12} className="shrink-0 text-ink-3" />
          <select
            aria-label="项目筛选"
            title="按项目筛选 Tab；只隐藏视图，不停止资源"
            value={filterValue(win.filter)}
            onChange={(event) => setFilter(win.id, filterFromValue(event.target.value))}
            className="h-6 max-w-[132px] min-w-0 rounded-md border border-line bg-surface px-1.5 text-[10.5px] text-ink-2 outline-none focus:border-accent/40"
          >
            <option value="all">全部项目</option>
            <option value="global">全局 / 未归属</option>
            {data.projects.map((project) => (
              <option key={project.id} value={`project:${project.id}`}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto px-2">
        {visible.map((tab, index) => {
          const active = tab.id === win.activeTabId;
          const project = data.projects.find((item) => item.id === tab.projectId) ?? null;
          const groupStart = index > 0 && visible[index - 1]?.projectId !== tab.projectId;
          const label = projectLabel(tab.projectId, tab.originType, project?.name);
          return (
            <div key={tab.id} className="flex shrink-0 items-end">
              {groupStart ? <span className="mx-1 mb-1 h-4 w-px bg-line" aria-hidden /> : null}
              <div
                className={cn(
                  "group flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[8px] border border-b-0 px-2.5 text-[10.5px] transition-colors",
                  active
                    ? "border-line bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:bg-black/[.03] hover:text-ink-2 dark:hover:bg-white/[.04]",
                )}
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: project?.accent ?? "var(--ink-3)" }}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => setActiveTab(win.id, tab.id)}
                  title={`${label} · ${tab.title}`}
                  className="flex min-w-0 flex-1 items-center gap-1.5 focus-visible:outline-none"
                >
                  <TabIcon kind={tab.kind} />
                  <span className="truncate">
                    {showProjectPrefix ? `${label} · ${tab.title}` : tab.title}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(win.id, tab.id);
                  }}
                  className="window-no-drag rounded p-0.5 text-ink-3 opacity-0 transition-opacity hover:bg-black/[.06] hover:text-ink group-hover:opacity-100 dark:hover:bg-white/[.08]"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {supportsFilter ? (
        <span
          className="flex shrink-0 items-center px-2 font-mono text-[9px] text-ink-3"
          title="可见 / 全部 Tab"
        >
          {visible.length}/{win.tabs.length}
        </span>
      ) : null}
    </div>
  );
}
