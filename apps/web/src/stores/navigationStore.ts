import { create } from "zustand";
import { persist } from "zustand/middleware";

interface DraftSession {
  id: string;
  projectId: string | null;
}

interface NavigationState {
  projectId: string | null;
  sessionId: string;
  draftSession: DraftSession | null;
  sidebarWidth: number;
  resourceWidth: number;
  sidebarCollapsed: boolean;
  resourceCollapsed: boolean;
  mobileSidebarOpen: boolean;
  expandedProjects: Record<string, boolean>;
  focusComposerNonce: number;
  selectSession: (sessionId: string, projectId: string | null) => void;
  startDraft: (projectId: string | null) => void;
  commitDraft: (sessionId: string, projectId: string | null) => void;
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
      draftSession: null,
      sidebarWidth: 268,
      resourceWidth: 340,
      sidebarCollapsed: false,
      resourceCollapsed: false,
      mobileSidebarOpen: false,
      expandedProjects: { prj_larness: true, prj_docs: true },
      focusComposerNonce: 0,

      selectSession: (sessionId, projectId) =>
        set({ sessionId, projectId, draftSession: null, mobileSidebarOpen: false }),

      startDraft: (projectId) =>
        set((state) => {
          if (state.draftSession !== null && state.draftSession.projectId === projectId) {
            return {
              sessionId: state.draftSession.id,
              projectId,
              mobileSidebarOpen: false,
            };
          }

          const id = `draft_${crypto.randomUUID()}`;
          return {
            draftSession: { id, projectId },
            sessionId: id,
            projectId,
            mobileSidebarOpen: false,
          };
        }),

      commitDraft: (sessionId, projectId) =>
        set({ sessionId, projectId, draftSession: null, mobileSidebarOpen: false }),

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
