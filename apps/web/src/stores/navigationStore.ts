import { create } from "zustand";
import { persist } from "zustand/middleware";
import { USE_MOCKS } from "@/lib/env";

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
  reconcileWorkspace: (
    projectIds: string[],
    sessions: { id: string; projectId: string | null }[],
  ) => void;
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
    (set, get) => ({
      projectId: USE_MOCKS ? "prj_larness" : null,
      sessionId: USE_MOCKS ? "ses_1" : "",
      draftSession: null,
      sidebarWidth: 268,
      resourceWidth: 340,
      sidebarCollapsed: false,
      resourceCollapsed: false,
      mobileSidebarOpen: false,
      expandedProjects: { prj_larness: true, prj_docs: true },
      focusComposerNonce: 0,

      reconcileWorkspace: (projectIds, sessions) => {
        const state = get();
        const validProject = state.projectId === null || projectIds.includes(state.projectId);
        if (
          validProject &&
          state.draftSession?.id === state.sessionId &&
          state.draftSession.projectId === state.projectId
        )
          return;
        const current = sessions.find((session) => session.id === state.sessionId);
        if (current) {
          if (current.projectId !== state.projectId || state.draftSession)
            get().selectSession(current.id, current.projectId);
          return;
        }
        const projectId = validProject ? state.projectId : null;
        if (validProject && state.sessionId.startsWith("draft_")) {
          set({ draftSession: { id: state.sessionId, projectId } });
          return;
        }
        get().startDraft(projectId);
      },

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
        draftSession: state.draftSession,
        sidebarWidth: state.sidebarWidth,
        resourceWidth: state.resourceWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        resourceCollapsed: state.resourceCollapsed,
        expandedProjects: state.expandedProjects,
      }),
    },
  ),
);
