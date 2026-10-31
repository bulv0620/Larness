import { cn } from "@harness/ui";
import { FileCode2, GitCompare, Globe2, Server, SquareTerminal, X } from "lucide-react";
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

export function WindowTabs({ window: win }: { window: ManagedWindow }) {
  const setActiveTab = useWindowStore((state) => state.setActiveTab);
  const closeTab = useWindowStore((state) => state.closeTab);

  return (
    <div className="flex h-8 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-line bg-surface-2/35 px-2">
      {win.tabs.map((tab) => {
        const active = tab.id === win.activeTabId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[8px] border border-b-0 px-2.5 text-[10.5px] transition-colors",
              active
                ? "border-line bg-surface text-ink"
                : "border-transparent text-ink-3 hover:bg-black/[.03] hover:text-ink-2 dark:hover:bg-white/[.04]",
            )}
          >
            <button
              type="button"
              onClick={() => setActiveTab(win.id, tab.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 focus-visible:outline-none"
            >
              <TabIcon kind={tab.kind} />
              <span className="truncate">{tab.title}</span>
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
        );
      })}
    </div>
  );
}
