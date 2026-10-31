import { useCallback } from "react";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";

export function useNewSession() {
  const create = useLocalSessionsStore((state) => state.create);
  const selectSession = useNavigationStore((state) => state.selectSession);
  const focusComposer = useNavigationStore((state) => state.focusComposer);

  return useCallback(() => {
    const projectId = useNavigationStore.getState().projectId;
    const session = create(projectId);
    selectSession(session.id, projectId);
    focusComposer();
  }, [create, selectSession, focusComposer]);
}
