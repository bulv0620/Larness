import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NavigationState {
  projectId: string | null;
  sessionId: string;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  expandedProjects: Record<string, boolean>;
  focusComposerNonce: number;
  selectSession: (sessionId: string, projectId: string | null) => void;
  toggleSidebar: () => void;
  setMobileSidebar: (open: boolean) => void;
  toggleProject: (projectId: string) => void;
  focusComposer: () => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      projectId: "prj_harness",
      sessionId: "ses_1",
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      expandedProjects: { prj_harness: true, prj_docs: true },
      focusComposerNonce: 0,

      selectSession: (sessionId, projectId) =>
        set({ sessionId, projectId, mobileSidebarOpen: false }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setMobileSidebar: (open) => set({ mobileSidebarOpen: open }),

      toggleProject: (projectId) =>
        set((state) => ({
          expandedProjects: {
            ...state.expandedProjects,
            [projectId]: !(state.expandedProjects[projectId] ?? true),
          },
        })),

      focusComposer: () => set((state) => ({ focusComposerNonce: state.focusComposerNonce + 1 })),
    }),
    {
      name: "harness.nav.v1",
      version: 1,
      partialize: (state) => ({
        projectId: state.projectId,
        sessionId: state.sessionId,
        sidebarCollapsed: state.sidebarCollapsed,
        expandedProjects: state.expandedProjects,
      }),
    },
  ),
);
