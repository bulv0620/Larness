import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NavigationState {
  projectId: string | null;
  sessionId: string;
  sidebarWidth: number;
  resourceWidth: number;
  sidebarCollapsed: boolean;
  resourceCollapsed: boolean;
  mobileSidebarOpen: boolean;
  expandedProjects: Record<string, boolean>;
  focusComposerNonce: number;
  selectSession: (sessionId: string, projectId: string | null) => void;
  setSidebarWidth: (width: number) => void;
  setResourceWidth: (width: number) => void;
  toggleSidebar: () => void;
  toggleResource: () => void;
  setMobileSidebar: (open: boolean) => void;
  toggleProject: (projectId: string) => void;
  focusComposer: () => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set) => ({
      projectId: "prj_larness",
      sessionId: "ses_1",
      sidebarWidth: 268,
      resourceWidth: 340,
      sidebarCollapsed: false,
      resourceCollapsed: false,
      mobileSidebarOpen: false,
      expandedProjects: { prj_larness: true, prj_docs: true },
      focusComposerNonce: 0,

      selectSession: (sessionId, projectId) =>
        set({ sessionId, projectId, mobileSidebarOpen: false }),

      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),

      setResourceWidth: (resourceWidth) => set({ resourceWidth }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      toggleResource: () => set((state) => ({ resourceCollapsed: !state.resourceCollapsed })),

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
      name: "larness.nav.v1",
      version: 1,
      partialize: (state) => ({
        projectId: state.projectId,
        sessionId: state.sessionId,
        sidebarWidth: state.sidebarWidth,
        resourceWidth: state.resourceWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        resourceCollapsed: state.resourceCollapsed,
        expandedProjects: state.expandedProjects,
      }),
    },
  ),
);
