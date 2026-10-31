import { create } from "zustand";
import { persist } from "zustand/middleware";
import { clampRect, defaultRect } from "@/lib/windowGeometry";
import type { ManagedWindow, Rect, WindowKind } from "@/lib/windowTypes";

interface OpenInput {
  kind: WindowKind;
  resourceId: string;
  title: string;
}

interface WindowState {
  windows: ManagedWindow[];
  focusedId: string | null;
  zCounter: number;
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

export const useWindowStore = create<WindowState>()(
  persist(
    (set, get) => ({
      windows: [],
      focusedId: null,
      zCounter: 10,

      open: ({ kind, resourceId, title }) => {
        const state = get();
        const tabMatch = state.windows.find((win) =>
          win.tabs.some((tab) => tab.kind === kind && tab.resourceId === resourceId),
        );

        const z = Math.max(state.zCounter + 1, topZ(state.windows) + 1);

        if (tabMatch) {
          const tab = tabMatch.tabs.find(
            (item) => item.kind === kind && item.resourceId === resourceId,
          );
          set({
            windows: state.windows.map((win) =>
              win.id === tabMatch.id
                ? { ...win, minimized: false, activeTabId: tab?.id ?? win.activeTabId, z }
                : win,
            ),
            focusedId: tabMatch.id,
            zCounter: z,
          });
          return;
        }

        const sameKind = state.windows.find((win) => win.tabs.some((tab) => tab.kind === kind));
        if (sameKind) {
          const tab = { id: uid("tab"), kind, resourceId, title };
          set({
            windows: state.windows.map((win) =>
              win.id === sameKind.id
                ? { ...win, tabs: [...win.tabs, tab], activeTabId: tab.id, minimized: false, z }
                : win,
            ),
            focusedId: sameKind.id,
            zCounter: z,
          });
          return;
        }

        const index = state.windows.length;
        const rect = defaultRect(kind, index, viewport());
        const tab = { id: uid("tab"), kind, resourceId, title };
        const managed: ManagedWindow = {
          id: uid("win"),
          tabs: [tab],
          activeTabId: tab.id,
          ...rect,
          z,
          minimized: false,
          maximized: false,
          pinned: false,
          restore: null,
        };
        set({ windows: [...state.windows, managed], focusedId: managed.id, zCounter: z });
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
          get().close(windowId);
          return;
        }
        const tabs = target.tabs.filter((tab) => tab.id !== tabId);
        set({
          windows: state.windows.map((win) =>
            win.id === windowId
              ? {
                  ...win,
                  tabs,
                  activeTabId:
                    win.activeTabId === tabId
                      ? (tabs[tabs.length - 1]?.id ?? tabs[0].id)
                      : win.activeTabId,
                }
              : win,
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
    }),
    {
      name: "harness.windows.v1",
      partialize: (state) => ({
        windows: state.windows,
        focusedId: state.focusedId,
        zCounter: state.zCounter,
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
