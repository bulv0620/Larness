import type { FileScope } from "@larness/shared";
import { queryClient } from "@/lib/queries";
import type { TabOrigin, WindowTab } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";
import { fileKey, readFile, writeFile } from "./api";
import { useFileDraftStore } from "./drafts";
export async function openFile(scope: FileScope, path: string, source: TabOrigin) {
  const doc = await queryClient.fetchQuery({
    queryKey: fileKey(scope, path),
    queryFn: () => readFile(scope, path),
    staleTime: 0,
  });
  useWindowStore.getState().open({
    kind: "files",
    resourceId: doc.realPath,
    title: doc.path.split("/").at(-1) ?? doc.path,
    projectId: "projectId" in scope ? scope.projectId : null,
    sessionId: "sessionId" in scope ? scope.sessionId : null,
    source,
    file: { scope, path: doc.path },
  });
  return doc;
}
const inFlight = new Map<string, Promise<void>>();
export function saveDraft(tab: WindowTab): Promise<void> {
  const existing = inFlight.get(tab.resourceId);
  if (existing) return existing;
  const draft = useFileDraftStore.getState().drafts[tab.resourceId];
  const target = tab.file;
  if (!draft || !target) return Promise.resolve();
  useFileDraftStore.setState((state) => ({ saving: { ...state.saving, [tab.resourceId]: true } }));
  const action = (async () => {
    try {
      const result = await writeFile(target.scope, target.path, draft.text, draft.baseVersion);
      queryClient.setQueryData(fileKey(target.scope, target.path), {
        ...result,
        content: draft.text,
        encoding: "utf-8",
      });
      const current = useFileDraftStore.getState().drafts[tab.resourceId];
      if (current === draft) useFileDraftStore.getState().discard(tab.resourceId);
      else if (current)
        useFileDraftStore.getState().edit(tab.resourceId, current.text, result.version);
    } finally {
      useFileDraftStore.setState((state) => ({
        saving: { ...state.saving, [tab.resourceId]: false },
      }));
      inFlight.delete(tab.resourceId);
      void queryClient.invalidateQueries({ queryKey: fileKey(target.scope, target.path) });
    }
  })();
  inFlight.set(tab.resourceId, action);
  return action;
}
