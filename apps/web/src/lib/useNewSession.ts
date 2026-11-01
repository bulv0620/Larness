import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { USE_MOCKS } from "@/lib/env";
import { createSession } from "@/lib/workspaceApi";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";

export function useNewSession() {
  const createLocal = useLocalSessionsStore((state) => state.create);
  const selectSession = useNavigationStore((state) => state.selectSession);
  const focusComposer = useNavigationStore((state) => state.focusComposer);
  const queryClient = useQueryClient();

  return useCallback(async () => {
    const projectId = useNavigationStore.getState().projectId;

    if (USE_MOCKS) {
      const session = createLocal(projectId);
      selectSession(session.id, projectId);
      focusComposer();
      return;
    }

    try {
      const session = await createSession(projectId === null ? {} : { projectId });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      selectSession(session.id, session.projectId);
      focusComposer();
    } catch (error) {
      const message = error instanceof Error ? error.message : "新建会话失败";
      window.dispatchEvent(new CustomEvent("larness:workspace-error", { detail: message }));
    }
  }, [createLocal, focusComposer, queryClient, selectSession]);
}
