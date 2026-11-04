import { cn } from "@larness/ui";
import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  GitCompare,
  Globe2,
  Plus,
  Server,
  SquareTerminal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFileDraftStore } from "@/features/files/drafts";
import { ended, readTerminal, stopConfirmed, terminalAction } from "@/features/terminals/api";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { filterTabs } from "@/lib/windowFilters";
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
  const [closing, setClosing] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState("");
  const saving = useFileDraftStore((state) => state.saving);
  const drafts = useFileDraftStore((state) => state.drafts);
  const setActiveTab = useWindowStore((state) => state.setActiveTab);
  const closeTab = useWindowStore((state) => state.closeTab);
  const { data } = useSnapshot();
  const visible = filterTabs(win.tabs, win.filter);
  const kind = win.tabs[0]?.kind;
  const tabsRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [rename, setRename] = useState<{ id: string; title: string } | null>(null);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el || !win.tabs.length) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    const observer = new ResizeObserver(check);
    observer.observe(el);
    check();
    el.querySelector(`[data-tab-id="${win.activeTabId}"]`)?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
    return () => observer.disconnect();
  }, [win.tabs, win.activeTabId]);

  return (
    <div className="relative flex h-8 shrink-0 items-stretch border-b border-line bg-surface-2/35">
      {terminalError ? (
        <p
          role="alert"
          className="absolute top-full left-0 z-50 rounded bg-surface p-2 text-xs text-danger"
        >
          {terminalError}
        </p>
      ) : null}
      {overflow ? (
        <button
          type="button"
          aria-label="向左滚动 Tab"
          className="shrink-0 px-1 text-ink-3 hover:text-ink"
          onClick={() => tabsRef.current?.scrollBy({ left: -180, behavior: "smooth" })}
        >
          <ChevronLeft size={13} />
        </button>
      ) : null}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="窗口 Tab"
        onKeyDown={(event) => {
          if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "tab")
            return;
          const current = visible.findIndex((tab) => tab.id === win.activeTabId);
          const index =
            event.key === "ArrowRight"
              ? (current + 1) % visible.length
              : event.key === "ArrowLeft"
                ? (current - 1 + visible.length) % visible.length
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? visible.length - 1
                    : -1;
          const next = visible[index];
          if (!next) return;
          event.preventDefault();
          setActiveTab(win.id, next.id);
          tabsRef.current?.querySelector<HTMLElement>(`[data-tab-id="${next.id}"]`)?.focus();
        }}
        className="window-tabs-scroll flex h-8 min-w-0 flex-1 items-end gap-0.5 overflow-x-auto overflow-y-hidden px-2"
        onWheel={(event) => {
          if (tabsRef.current && Math.abs(event.deltaY) > Math.abs(event.deltaX))
            tabsRef.current.scrollLeft += event.deltaY;
        }}
      >
        {visible.map((tab) => {
          const active = tab.id === win.activeTabId;
          const project = data.projects.find((item) => item.id === tab.projectId) ?? null;

          const label = projectLabel(tab.projectId, tab.originType, project?.name);
          return (
            <div key={tab.id} className="flex shrink-0 items-end">
              <div
                className={cn(
                  "group flex h-7 max-w-[220px] shrink-0 items-center gap-1.5 rounded-t-[8px] border border-b-0 px-2.5 text-[10.5px] transition-colors",
                  active
                    ? "border-line bg-surface text-ink"
                    : "border-transparent text-ink-3 hover:bg-black/[.03] hover:text-ink-2 dark:hover:bg-white/[.04]",
                )}
              >
                {rename?.id === tab.id ? (
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      try {
                        await terminalAction(tab.resourceId, "rename", { title: rename.title });
                        setRename(null);
                      } catch {
                        setTerminalError("改名失败，请重试。");
                      }
                    }}
                  >
                    <input
                      ref={(node) => node?.focus()}
                      aria-label="终端名称"
                      maxLength={80}
                      value={rename.title}
                      onChange={(event) => setRename({ ...rename, title: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") setRename(null);
                      }}
                      className="w-32 rounded border border-accent/40 bg-surface px-1 text-[11px] outline-none"
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    data-tab-id={tab.id}
                    role="tab"
                    aria-selected={active}
                    onDoubleClick={() => {
                      if (tab.kind === "terminal" && tab.resourceId.startsWith("term_"))
                        setRename({ id: tab.id, title: tab.title });
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "F2" &&
                        tab.kind === "terminal" &&
                        tab.resourceId.startsWith("term_")
                      ) {
                        event.preventDefault();
                        setRename({ id: tab.id, title: tab.title });
                      }
                    }}
                    onClick={() => setActiveTab(win.id, tab.id)}
                    title={`${label} · ${tab.title}${tab.kind === "terminal" ? " · 双击或 F2 改名" : ""}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 focus-visible:outline-none"
                  >
                    <TabIcon kind={tab.kind} />
                    <span className="truncate">
                      {tab.title}
                      {drafts[tab.resourceId] ? " ●" : ""}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`关闭 ${tab.title}`}
                  disabled={!!closing || (saving[tab.resourceId] ?? false)}
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (
                      !USE_MOCKS &&
                      tab.kind === "terminal" &&
                      tab.resourceId !== "terminal:empty"
                    ) {
                      setClosing(tab.id);
                      setTerminalError("");
                      try {
                        const row = await readTerminal(tab.resourceId);
                        const result = ended(row.status)
                          ? row
                          : await terminalAction(tab.resourceId, "terminate", { confirmed: true });
                        if (!stopConfirmed(result)) throw new Error("Termination unconfirmed");
                        closeTab(win.id, tab.id);
                      } catch {
                        setTerminalError("终止未确认，已保留 Tab；请核对状态后重试。");
                      } finally {
                        setClosing(null);
                      }
                      return;
                    }
                    if (tab.file && drafts[tab.resourceId])
                      useFileDraftStore.setState({
                        closeRequest: { windowId: win.id, tabId: tab.id },
                      });
                    else closeTab(win.id, tab.id);
                  }}
                  className="window-no-drag rounded p-0.5 text-ink-3 opacity-70 transition-opacity hover:bg-black/[.06] hover:text-ink group-hover:opacity-100 dark:hover:bg-white/[.08]"
                >
                  <X size={10} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {overflow ? (
        <button
          type="button"
          aria-label="向右滚动 Tab"
          className="shrink-0 px-1 text-ink-3 hover:text-ink"
          onClick={() => tabsRef.current?.scrollBy({ left: 180, behavior: "smooth" })}
        >
          <ChevronRight size={13} />
        </button>
      ) : null}
      {kind === "terminal" ? (
        <button
          type="button"
          aria-label="新建终端 Tab"
          title="新建终端"
          className="flex w-8 shrink-0 items-center justify-center text-ink-3 hover:bg-surface-2 hover:text-ink"
          onClick={() =>
            useWindowStore.getState().open({
              kind: "terminal",
              resourceId: "terminal:empty",
              title: "终端",
              projectId: win.tabs[0]?.projectId,
              sessionId: win.tabs[0]?.sourceSessionId,
              source: "project",
            })
          }
        >
          <Plus size={14} />
        </button>
      ) : null}
    </div>
  );
}
