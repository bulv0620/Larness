import { useCallback } from "react";
import { USE_MOCKS } from "@/lib/env";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";

export function useNewSession() {
  const createLocal = useLocalSessionsStore((state) => state.create);
  const startDraft = useNavigationStore((state) => state.startDraft);
  const selectSession = useNavigationStore((state) => state.selectSession);
  const focusComposer = useNavigationStore((state) => state.focusComposer);

  return useCallback(async () => {
    const projectId = useNavigationStore.getState().projectId;

    if (USE_MOCKS) {
      const session = createLocal(projectId);
      selectSession(session.id, projectId);
      focusComposer();
      return;
    }

    startDraft(projectId);
    focusComposer();
  }, [createLocal, focusComposer, selectSession, startDraft]);
}
