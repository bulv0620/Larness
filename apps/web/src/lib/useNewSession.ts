import { DEFAULT_PROJECT_ID } from "@larness/shared";
import { useCallback } from "react";
import { USE_MOCKS } from "@/lib/env";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";

export function useNewSession() {
  const createLocal = useLocalSessionsStore((state) => state.create);
  const startDraft = useNavigationStore((state) => state.startDraft);
  const expandProject = useNavigationStore((state) => state.expandProject);
  const selectSession = useNavigationStore((state) => state.selectSession);
  const focusComposer = useNavigationStore((state) => state.focusComposer);

  return useCallback(async () => {
    const projectId = useNavigationStore.getState().projectId;
    expandProject(projectId ?? DEFAULT_PROJECT_ID);

    if (USE_MOCKS) {
      const session = createLocal(projectId);
      selectSession(session.id, projectId);
      focusComposer();
      return;
    }

    startDraft(projectId);
    focusComposer();
  }, [createLocal, expandProject, focusComposer, selectSession, startDraft]);
}
