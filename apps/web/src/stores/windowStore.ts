import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useFileDraftStore } from "@/features/files/drafts";
import { USE_MOCKS } from "@/lib/env";
import { animateMinimize, cancelMinimize } from "@/lib/minimizeWindow";
import { activeWindowTab, filterTabs, insertIntoTabGroup, isTabVisible } from "@/lib/windowFilters";
import { clampRect, defaultRect, type Viewport } from "@/lib/windowGeometry";
import type {
  ManagedWindow,
  ProjectFilter,
  Rect,
  TabOrigin,
  WindowKind,
  WindowTab,
} from "@/lib/windowTypes";

export function resourceScopeKey(
  projectId: string | null,
  sessionId: string | null = null,
): string {
  return projectId ? `project:${projectId}` : sessionId ? `session:${sessionId}` : "global";
}
export function windowScopeKey(win: ManagedWindow): string {
  const tab = win.tabs[0];
  return resourceScopeKey(tab?.projectId ?? null, tab?.sourceSessionId ?? null);
}

type OpenSource = TabOrigin | "header";

interface OpenInput {
  kind: WindowKind;
  resourceId: string;
  title: string;
  projectId?: string | null;
  sessionId?: string | null;
  source?: OpenSource;
  file?: WindowTab["file"];
  preview?: boolean;
  treeWidth?: number;
  git?: WindowTab["git"];
  browser?: WindowTab["browser"];
  /** Agent-created resources are inserted without taking focus unless explicitly opened. */
  activate?: boolean;
}

interface WindowState {
  closeRequest: { windowId: string; tabIds: string[] } | null;
  windows: ManagedWindow[];
  focusedId: string | null;
  zCounter: number;
  lastFilters: Partial<Record<WindowKind, ProjectFilter>>;
  open: (input: OpenInput) => void;
  focus: (id: string) => void;
  close: (id: string) => void;
  hide: (id: string) => void;
  hideScope: (scope: string) => void;
  restore: (id: string) => void;
  toggleMaximize: (id: string) => void;
  togglePin: (id: string) => void;
  setActiveTab: (windowId: string, tabId: string) => void;
  keepFileTab: (tabId: string) => void;
  fitFileWindowBesideTree: (tabId: string, resourceWidth: number) => void;
  closeTab: (windowId: string, tabId: string) => void;
  setBounds: (id: string, rect: Rect) => void;
  setFilter: (windowId: string, filter: ProjectFilter) => void;
}

function viewport() {
  return { width: window.innerWidth, height: Math.max(480, window.innerHeight - 48) };
}

function besideTree(bounds: Viewport, resourceWidth: number): Viewport {
  return { ...bounds, width: bounds.width - resourceWidth };
}

function uid(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
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

interface PersistedLayout {
  windows?: ManagedWindow[];
  focusedId?: string | null;
  zCounter?: number;
  lastFilters?: Partial<Record<WindowKind, ProjectFilter>>;
}

const DEMO_RESOURCE_IDS = new Set(["ter_1", "svc_web_dev", "browser_preview"]);

function isDemoTab(tab: WindowTab): boolean {
  return (
    tab.projectId === "prj_larness" ||
    DEMO_RESOURCE_IDS.has(tab.resourceId) ||
    (tab.kind === "services" && tab.resourceId.startsWith("svc_")) ||
    (tab.kind === "browser" && tab.browser === undefined) ||
    (tab.kind === "files" && tab.file === undefined) ||
    (tab.kind === "git-diff" && tab.git === undefined)
  );
}

export function migrateWindowLayout(persisted: unknown, _version: number): unknown {
  const value = (persisted ?? {}) as PersistedLayout;
  if (!Array.isArray(value.windows)) return persisted;
  const now = Date.now();
  let counter = 0;
  const windows = value.windows.flatMap((win) => {
    const tabs = win.tabs
      .filter((tab) => USE_MOCKS || !isDemoTab(tab))
      .map((tab) => ({
        ...tab,
        viewKey:
          tab.viewKey ??
          (tab.kind === "files" && tab.file
            ? `file:${tab.resourceId}`
            : tab.kind === "git-diff" && tab.git
              ? `diff:${tab.projectId}:${tab.git.path}`
              : tab.kind === "browser" && tab.browser
                ? `browser:${tab.browser.serviceId}:${tab.browser.path}`
                : `${tab.kind}:${tab.resourceId}`),
        createdAt: tab.createdAt ?? now + counter++,
      }));
    if (!tabs.length) return [];
    const groups = new Map<string, WindowTab[]>();
    for (const tab of tabs) {
      const key = `${tab.kind}:${resourceScopeKey(tab.projectId, tab.sourceSessionId)}`;
      groups.set(key, [...(groups.get(key) ?? []), tab]);
    }
    return [...groups.values()].map((group, index) => ({
      ...win,
      id: index === 0 ? win.id : `${win.id}:scope:${index}`,
      tabs: group,
      filter: { mode: "all" } as ProjectFilter,
      activeTabId: activeWindowTab(group, win.activeTabId)?.id ?? null,
    }));
  });
  const focusedId = windows.some((win) => win.id === value.focusedId)
    ? (value.focusedId ?? null)
    : (windows.at(-1)?.id ?? null);
  return {
    windows,
    focusedId,
    zCounter: value.zCounter ?? 10,
    lastFilters: value.lastFilters ?? {},
  };
}

export const useWindowStore = create<WindowState>()(
  persist(
    (set, get) => ({
      closeRequest: null,
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
        preview = false,
        treeWidth,
        git,
        browser,
        activate = true,
      }) => {
        const state = get();
        const viewKey =
          kind === "files" && file
            ? `file:${resourceId}`
            : kind === "git-diff" && git
              ? `diff:${projectId}:${git.path}`
              : kind === "browser" && browser
                ? `browser:${browser.serviceId}:${browser.path}`
                : `${kind}:${resourceId}`;
        const scope = resourceScopeKey(projectId, sessionId);
        const tabMatch = state.windows.find(
          (win) =>
            windowScopeKey(win) === scope &&
            win.tabs.some((tab) =>
              tab.viewKey
                ? tab.viewKey === viewKey
                : tab.kind === kind && tab.resourceId === resourceId,
            ),
        );
        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);
        const preferred = preferredFilter(source, projectId);

        if (tabMatch) {
          if (activate) cancelMinimize(tabMatch.id);
          const tab = tabMatch.tabs.find((item) =>
            item.viewKey
              ? item.viewKey === viewKey
              : item.kind === kind && item.resourceId === resourceId,
          );
          const updatedTab =
            tab && (file || git || browser)
              ? {
                  ...tab,
                  ...(file ? { file, preview: preview && tab.preview === true } : {}),
                  ...(git ? { git } : {}),
                  ...(browser ? { browser } : {}),
                  projectId,
                  sourceSessionId: sessionId,
                  originType: originFor(source),
                }
              : undefined;
          const updatedTabs =
            updatedTab && tab
              ? tab.projectId === projectId
                ? tabMatch.tabs.map((item) => (item.id === tab.id ? updatedTab : item))
                : insertIntoTabGroup(
                    tabMatch.tabs.filter((item) => item.id !== tab.id),
                    updatedTab,
                  )
              : tabMatch.tabs;
          const tabVisible = tab ? isTabVisible(tab, tabMatch.filter) : false;
          const nextFilter: ProjectFilter = activate
            ? (preferred ?? (tabVisible ? tabMatch.filter : { mode: "all" }))
            : tabVisible
              ? tabMatch.filter
              : { mode: "all" };
          set({
            windows: state.windows.map((win) =>
              win.id === tabMatch.id
                ? {
                    ...win,
                    ...(activate
                      ? { minimized: false, activeTabId: tab?.id ?? win.activeTabId, z }
                      : {}),
                    filter: nextFilter,
                    tabs: updatedTabs,
                  }
                : win,
            ),
            ...(activate ? { focusedId: tabMatch.id } : {}),
            zCounter: activate ? z : state.zCounter,
            lastFilters: { ...state.lastFilters, [kind]: nextFilter },
          });
          if (tab && treeWidth) get().fitFileWindowBesideTree(tab.id, treeWidth);
          return;
        }

        const tab: WindowTab = {
          id: uid("tab"),
          kind,
          resourceId,
          viewKey,
          createdAt: Date.now(),
          title,
          projectId,
          sourceSessionId: sessionId,
          originType: originFor(source),
          ...(file ? { file, preview } : {}),
          ...(git ? { git } : {}),
          ...(browser ? { browser } : {}),
        };

        const sameKind = state.windows.find(
          (win) => windowScopeKey(win) === scope && win.tabs.some((item) => item.kind === kind),
        );
        if (sameKind) {
          if (activate) cancelMinimize(sameKind.id);
          let tabs = sameKind.tabs;
          if (tab.preview) {
            const { drafts, saving } = useFileDraftStore.getState();
            tabs = tabs.flatMap((item) => {
              if (!item.preview) return [item];
              return drafts[item.resourceId] || saving[item.resourceId]
                ? [{ ...item, preview: false }]
                : [];
            });
          }
          tabs = insertIntoTabGroup(tabs, tab);
          let filter = preferred ?? sameKind.filter;
          if (!isTabVisible(tab, filter)) filter = { mode: "all" };
          set({
            windows: state.windows.map((win) =>
              win.id === sameKind.id
                ? {
                    ...win,
                    tabs,
                    ...(activate ? { activeTabId: tab.id, minimized: false, z } : {}),
                    filter,
                  }
                : win,
            ),
            ...(activate ? { focusedId: sameKind.id } : {}),
            zCounter: activate ? z : state.zCounter,
            lastFilters: { ...state.lastFilters, [kind]: filter },
          });
          if (treeWidth) get().fitFileWindowBesideTree(tab.id, treeWidth);
          return;
        }

        let filter = preferred ?? state.lastFilters[kind] ?? ({ mode: "all" } as ProjectFilter);
        if (!isTabVisible(tab, filter)) filter = { mode: "all" };
        const bounds = viewport();
        const rect = defaultRect(
          kind,
          state.windows.length,
          kind === "files" && treeWidth ? besideTree(bounds, treeWidth) : bounds,
        );
        const managed: ManagedWindow = {
          id: uid("win"),
          tabs: [tab],
          activeTabId: activate ? tab.id : null,
          filter,
          ...rect,
          z,
          minimized: !activate,
          maximized: false,
          pinned: false,
          restore: null,
        };
        set({
          windows: [...state.windows, managed],
          ...(activate ? { focusedId: managed.id } : {}),
          zCounter: z,
          lastFilters: { ...state.lastFilters, [kind]: filter },
        });
      },

      focus: (id) => {
        cancelMinimize(id);
        const state = get();
        const target = state.windows.find((win) => win.id === id);
        if (!target) return;
        const activeTabId =
          activeWindowTab(filterTabs(target.tabs, target.filter), target.activeTabId)?.id ?? null;
        if (state.focusedId === id && !target.minimized && activeTabId === target.activeTabId)
          return;
        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);
        set({
          windows: state.windows.map((win) =>
            win.id === id ? { ...win, activeTabId, minimized: false, z } : win,
          ),
          focusedId: id,
          zCounter: z,
        });
      },

      close: (id) => {
        const win = get().windows.find((item) => item.id === id);
        if (!win) return;
        if (win.tabs.some((tab) => ["files", "git-diff", "browser"].includes(tab.kind)))
          set({ closeRequest: { windowId: id, tabIds: win.tabs.map((tab) => tab.id) } });
        else get().hide(id);
      },

      hide: (id) => {
        animateMinimize(id, () => {
          const state = get();
          set({
            windows: state.windows.map((win) =>
              win.id === id ? { ...win, minimized: true } : win,
            ),
            focusedId:
              state.focusedId === id
                ? (state.windows.find((win) => win.id !== id && !win.minimized)?.id ?? null)
                : state.focusedId,
          });
        });
      },

      hideScope: (scope) => {
        const { windows, hide } = get();
        for (const win of windows) {
          if (!win.minimized && !win.pinned && windowScopeKey(win) === scope) hide(win.id);
        }
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

      keepFileTab: (tabId) => {
        const { windows } = get();
        const win = windows.find((item) =>
          item.tabs.some((tab) => tab.id === tabId && tab.preview),
        );
        if (!win) return;
        set({
          windows: windows.map((item) =>
            item.id === win.id
              ? {
                  ...item,
                  tabs: item.tabs.map((tab) =>
                    tab.id === tabId ? { ...tab, preview: false } : tab,
                  ),
                }
              : item,
          ),
        });
      },

      fitFileWindowBesideTree: (tabId, resourceWidth) => {
        const { windows } = get();
        const bounds = besideTree(viewport(), resourceWidth);
        const win = windows.find((item) => item.tabs.some((tab) => tab.id === tabId && tab.file));
        if (!win || (!win.maximized && win.x + win.width <= bounds.width)) return;
        set({
          windows: windows.map((item) =>
            item.id === win.id
              ? { ...win, ...clampRect(win, bounds), maximized: false, restore: null }
              : item,
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
        const activeTabId = activeWindowTab(visible, target.activeTabId)?.id ?? null;
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
        const activeTabId = activeWindowTab(visible, target.activeTabId)?.id ?? null;
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
      version: 4,
      migrate: migrateWindowLayout,
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
