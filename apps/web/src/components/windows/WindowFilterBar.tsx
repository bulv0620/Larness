import { FolderTree } from "lucide-react";
import { useSnapshot } from "@/lib/queries";
import { filterFromValue, filterTabs, filterValue } from "@/lib/windowFilters";
import type { ManagedWindow } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";

export function WindowFilterBar({ window: win }: { window: ManagedWindow }) {
  const { data } = useSnapshot();
  const setFilter = useWindowStore((state) => state.setFilter);
  const visible = filterTabs(win.tabs, win.filter);

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-surface-2/25 px-3">
      <FolderTree size={12} className="shrink-0 text-ink-3" />
      <span className="shrink-0 text-[9.5px] font-medium text-ink-3">项目</span>
      <select
        aria-label="项目筛选"
        value={filterValue(win.filter)}
        onChange={(event) => setFilter(win.id, filterFromValue(event.target.value))}
        className="h-6 min-w-0 max-w-[150px] rounded-md border border-line bg-surface px-1.5 text-[10.5px] text-ink-2 outline-none focus:border-accent/40"
      >
        <option value="all">全部项目</option>
        <option value="global">全局 / 未归属</option>
        {data.projects.map((project) => (
          <option key={project.id} value={`project:${project.id}`}>
            {project.name}
          </option>
        ))}
      </select>
      <span className="ml-auto shrink-0 font-mono text-[9px] text-ink-3">
        {visible.length}/{win.tabs.length} 个 Tab
      </span>
    </div>
  );
}
