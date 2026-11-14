import { create } from "zustand";
import { persist } from "zustand/middleware";
import { USE_MOCKS } from "@/lib/env";
import type { ModelSelection } from "@/lib/workspaceApi";

interface DraftSession {
  id: string;
  projectId: string | null;
  selection?: ModelSelection;
}

interface NavigationState {
  projectId: string | null;
  sessionId: string;
  pinnedSessionId: string | null;
  draftSession: DraftSession | null;
  sidebarWidth: number;
  resourceWidth: number;
  sidebarCollapsed: boolean;
  resourceCollapsed: boolean;
  mobileSidebarOpen: boolean;
  expandedProjects: Record<string, boolean>;
  expandedFileDirectories: Record<string, string[]>;
  resourceTab: "files" | "git";
  fileReveal: { scope: string; path: string } | null;
  setResourceTab: (tab: "files" | "git") => void;
  revealFile: (scope: string, path: string) => void;
  setExpandedFileDirectories: (scope: string, paths: string[]) => void;
  focusComposerNonce: number;
  reconcileWorkspace: (
    projectIds: string[],
    sessions: { id: string; projectId: string | null }[],
  ) => void;
  selectSession: (sessionId: string, projectId: string | null) => void;
  openPinnedSession: (sessionId: string, projectId: string | null) => void;
  startDraft: (projectId: string | null) => void;
  setDraftModel: (id: string, selection: ModelSelection) => void;
  commitDraft: (draftId: string, sessionId: string, projectId: string | null) => void;
  setSidebarWidth: (width: number) => void;
  setResourceWidth: (width: number) => void;
  toggleSidebar: () => void;
  toggleResource: () => void;
  setMobileSidebar: (open: boolean) => void;
  toggleProject: (projectId: string) => void;
  setExpandedProjects: (expandedProjects: Record<string, boolean>) => void;
  focusComposer: () => void;
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      projectId: USE_MOCKS ? "prj_larness" : null,
      sessionId: USE_MOCKS ? "ses_1" : "",
      pinnedSessionId: null,
      draftSession: null,
      sidebarWidth: 268,
      resourceWidth: 340,
      sidebarCollapsed: false,
      resourceCollapsed: false,
      mobileSidebarOpen: false,
      expandedProjects: { prj_larness: true, prj_docs: true },
      focusComposerNonce: 0,
      expandedFileDirectories: {},
      resourceTab: "files",
      fileReveal: null,

      setResourceTab: (resourceTab) => set({ resourceTab, fileReveal: null }),

      revealFile: (scope, path) =>
        set((state) => {
          const parents = path.split("/").slice(0, -1);
          return {
            resourceTab: "files",
            resourceCollapsed: false,
            fileReveal: { scope, path },
            expandedFileDirectories: {
              ...state.expandedFileDirectories,
              [scope]: [
                ...new Set([
                  ".",
                  ...(state.expandedFileDirectories[scope] ?? []),
                  ...parents.map((_, index) => parents.slice(0, index + 1).join("/")),
                ]),
              ],
            },
          };
        }),

      setExpandedFileDirectories: (scope, paths) =>
        set((state) => ({
          expandedFileDirectories: { ...state.expandedFileDirectories, [scope]: paths },
          fileReveal: null,
        })),

      reconcileWorkspace: (projectIds, sessions) => {
        const state = get();
        if (state.sessionId !== "" && state.sessionId === state.pinnedSessionId) {
          return;
        }
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
        set({
          sessionId,
          projectId,
          fileReveal: null,
          pinnedSessionId: null,
          draftSession: null,
          mobileSidebarOpen: false,
        }),

      openPinnedSession: (sessionId, projectId) =>
        set({
          sessionId,
          projectId,
          fileReveal: null,
          pinnedSessionId: sessionId,
          draftSession: null,
          mobileSidebarOpen: false,
        }),

      startDraft: (projectId) =>
        set((state) => {
          if (state.draftSession !== null && state.draftSession.projectId === projectId) {
            return {
              sessionId: state.draftSession.id,
              projectId,
              fileReveal: null,
              mobileSidebarOpen: false,
            };
          }

          const id = `draft_${crypto.randomUUID()}`;
          return {
            draftSession: { id, projectId },
            sessionId: id,
            projectId,
            fileReveal: null,
            mobileSidebarOpen: false,
          };
        }),

      setDraftModel: (id, selection) =>
        set((state) =>
          state.draftSession?.id === id
            ? { draftSession: { ...state.draftSession, selection } }
            : state,
        ),

      commitDraft: (draftId, sessionId, projectId) =>
        set((state) =>
          state.sessionId === draftId
            ? { sessionId, projectId, draftSession: null, mobileSidebarOpen: false }
            : state,
        ),

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

      setExpandedProjects: (expandedProjects) => set({ expandedProjects }),

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
        expandedFileDirectories: state.expandedFileDirectories,
      }),
    },
  ),
);
