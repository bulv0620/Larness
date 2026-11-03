import { create } from "zustand";
import { persist } from "zustand/middleware";
import { filterTabs, insertIntoTabGroup, isTabVisible } from "@/lib/windowFilters";
import { clampRect, defaultRect } from "@/lib/windowGeometry";
import type {
  ManagedWindow,
  ProjectFilter,
  Rect,
  TabOrigin,
  WindowKind,
  WindowTab,
} from "@/lib/windowTypes";

type OpenSource = TabOrigin | "header";

interface OpenInput {
  kind: WindowKind;
  resourceId: string;
  title: string;
  projectId?: string | null;
  sessionId?: string | null;
  source?: OpenSource;
  file?: WindowTab["file"];
}

interface WindowState {
  windows: ManagedWindow[];
  focusedId: string | null;
  zCounter: number;
  lastFilters: Partial<Record<WindowKind, ProjectFilter>>;
  open: (input: OpenInput) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  hide: (id: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  togglePin: (id: string) => void;
  setActiveTab: (windowId: string, tabId: string) => void;
  closeTab: (windowId: string, tabId: string) => void;
  setBounds: (id: string, rect: Rect) => void;
  setFilter: (windowId: string, filter: ProjectFilter) => void;
}

function viewport() {
  return { width: window.innerWidth, height: Math.max(480, window.innerHeight - 48) };
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function topZ(windows: ManagedWindow[]): number {
  return windows.reduce((max, item) => Math.max(max, item.z), 0);
}

function originFor(source: OpenSource | undefined): TabOrigin {
  if (!source || source === "header") return "global";
  return source;
}

function preferredFilter(
  source: OpenSource | undefined,
  projectId: string | null,
): ProjectFilter | null {
  if (!source || source === "header") return null;
  return projectId ? { mode: "project", projectId } : { mode: "global" };
}

export const useWindowStore = create<WindowState>()(
  persist(
    (set, get) => ({
      windows: [],
      focusedId: null,
      zCounter: 10,
      lastFilters: {},

      open: ({
        kind,
        resourceId,
        title,
        projectId = null,
        sessionId = null,
        source = "header",
        file,
      }) => {
        const state = get();
        const tabMatch = state.windows.find((win) =>
          win.tabs.some((tab) => tab.kind === kind && tab.resourceId === resourceId),
        );
        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);
        const preferred = preferredFilter(source, projectId);

        if (tabMatch) {
          const tab = tabMatch.tabs.find(
            (item) => item.kind === kind && item.resourceId === resourceId,
          );
          const updatedFileTab =
            tab && file
              ? {
                  ...tab,
                  file,
                  projectId,
                  sourceSessionId: sessionId,
                  originType: originFor(source),
                }
              : undefined;
          const updatedTabs =
            updatedFileTab && tab
              ? tab.projectId === projectId
                ? tabMatch.tabs.map((item) => (item.id === tab.id ? updatedFileTab : item))
                : insertIntoTabGroup(
                    tabMatch.tabs.filter((item) => item.id !== tab.id),
                    updatedFileTab,
                  )
              : tabMatch.tabs;
          const nextFilter =
            preferred ??
            (tab && isTabVisible(tab, tabMatch.filter) ? tabMatch.filter : { mode: "all" });
          set({
            windows: state.windows.map((win) =>
              win.id === tabMatch.id
                ? {
                    ...win,
                    minimized: false,
                    activeTabId: tab?.id ?? win.activeTabId,
                    z,
                    filter: nextFilter,
                    tabs: updatedTabs,
                  }
                : win,
            ),
            focusedId: tabMatch.id,
            zCounter: z,
            lastFilters: { ...state.lastFilters, [kind]: nextFilter },
          });
          return;
        }

        const tab: WindowTab = {
          id: uid("tab"),
          kind,
          resourceId,
          title,
          projectId,
          sourceSessionId: sessionId,
          originType: originFor(source),
          ...(file ? { file } : {}),
        };

        const sameKind = state.windows.find((win) => win.tabs.some((item) => item.kind === kind));
        if (sameKind) {
          const tabs = insertIntoTabGroup(sameKind.tabs, tab);
          let filter = preferred ?? sameKind.filter;
          if (!isTabVisible(tab, filter)) filter = { mode: "all" };
          set({
            windows: state.windows.map((win) =>
              win.id === sameKind.id
                ? { ...win, tabs, activeTabId: tab.id, filter, minimized: false, z }
                : win,
            ),
            focusedId: sameKind.id,
            zCounter: z,
            lastFilters: { ...state.lastFilters, [kind]: filter },
          });
          return;
        }

        let filter = preferred ?? state.lastFilters[kind] ?? ({ mode: "all" } as ProjectFilter);
        if (!isTabVisible(tab, filter)) filter = { mode: "all" };
        const rect = defaultRect(kind, state.windows.length, viewport());
        const managed: ManagedWindow = {
          id: uid("win"),
          tabs: [tab],
          activeTabId: tab.id,
          filter,
          ...rect,
          z,
          minimized: false,
          maximized: false,
          pinned: false,
          restore: null,
        };
        set({
          windows: [...state.windows, managed],
          focusedId: managed.id,
          zCounter: z,
          lastFilters: { ...state.lastFilters, [kind]: filter },
        });
      },

      focus: (id) => {
        const state = get();
        const target = state.windows.find((win) => win.id === id);
        if (!target) return;
        if (state.focusedId === id && !target.minimized) return;
        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);
        set({
          windows: state.windows.map((win) =>
            win.id === id ? { ...win, minimized: false, z } : win,
          ),
          focusedId: id,
          zCounter: z,
        });
      },

      close: (id) => {
        const state = get();
        if (state.windows.find((win) => win.id === id)?.tabs.some((tab) => tab.file)) {
          get().hide(id);
          return;
        }
        const windows = state.windows.filter((win) => win.id !== id);
        set({
          windows,
          focusedId: windows.length ? (windows[windows.length - 1]?.id ?? null) : null,
        });
      },

      hide: (id) => {
        const state = get();
        set({
          windows: state.windows.map((win) => (win.id === id ? { ...win, minimized: true } : win)),
          focusedId: state.windows.find((win) => win.id !== id && !win.minimized)?.id ?? null,
        });
      },

      restore: (id) => {
        get().focus(id);
      },

      toggleMaximize: (id) => {
        const state = get();
        set({
          windows: state.windows.map((win) =>
            win.id === id
              ? {
                  ...win,
                  maximized: !win.maximized,
                  restore: win.maximized
                    ? null
                    : { x: win.x, y: win.y, width: win.width, height: win.height },
                }
              : win,
          ),
        });
      },

      togglePin: (id) => {
        const state = get();
        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);
        set({
          windows: state.windows.map((win) =>
            win.id === id ? { ...win, pinned: !win.pinned, z } : win,
          ),
          zCounter: z,
          focusedId: id,
        });
      },

      setActiveTab: (windowId, tabId) => {
        set({
          windows: get().windows.map((win) =>
            win.id === windowId ? { ...win, activeTabId: tabId } : win,
          ),
        });
      },

      closeTab: (windowId, tabId) => {
        const state = get();
        const target = state.windows.find((win) => win.id === windowId);
        if (!target) return;
        if (target.tabs.length <= 1) {
          set({ windows: state.windows.filter((win) => win.id !== windowId), focusedId: null });
          return;
        }
        const tabs = target.tabs.filter((tab) => tab.id !== tabId);
        const visible = filterTabs(tabs, target.filter);
        const activeTabId =
          target.activeTabId === tabId ? (visible[0]?.id ?? null) : target.activeTabId;
        set({
          windows: state.windows.map((win) =>
            win.id === windowId ? { ...win, tabs, activeTabId } : win,
          ),
        });
      },

      setBounds: (id, rect) => {
        const state = get();
        set({
          windows: state.windows.map((win) =>
            win.id === id ? { ...win, ...clampRect(rect, viewport()) } : win,
          ),
        });
      },

      setFilter: (windowId, filter) => {
        const state = get();
        const target = state.windows.find((win) => win.id === windowId);
        if (!target) return;
        const visible = filterTabs(target.tabs, filter);
        const activeTabId =
          visible.find((tab) => tab.id === target.activeTabId)?.id ?? visible[0]?.id ?? null;
        set({
          windows: state.windows.map((win) =>
            win.id === windowId ? { ...win, filter, activeTabId } : win,
          ),
          lastFilters: { ...state.lastFilters, [target.tabs[0]?.kind ?? "terminal"]: filter },
        });
      },
    }),
    {
      name: "larness.windows.v2",
      version: 2,
      partialize: (state) => ({
        windows: state.windows,
        focusedId: state.focusedId,
        zCounter: state.zCounter,
        lastFilters: state.lastFilters,
      }),
    },
  ),
);

export function visibleWindow(
  windows: ManagedWindow[],
  kind: WindowKind,
): ManagedWindow | undefined {
  return windows.find((win) => !win.minimized && win.tabs.some((tab) => tab.kind === kind));
}

export function anyWindow(windows: ManagedWindow[], kind: WindowKind): ManagedWindow | undefined {
  return windows.find((win) => win.tabs.some((tab) => tab.kind === kind));
}

export { filterValue } from "@/lib/windowFilters";
export type { OpenInput };
export { filterTabs };
