import type { FileActionResult, FileScope } from "@larness/shared";
import { queryClient } from "@/lib/queries";
import type { TabOrigin, WindowTab } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";
import { fileKey, readFile, scopeId, writeFile } from "./api";
import { useFileDraftStore } from "./drafts";
export async function openFile(
  scope: FileScope,
  path: string,
  source: TabOrigin,
  {
    preview = false,
    signal,
    treeWidth,
  }: {
    preview?: boolean;
    signal?: AbortSignal;
    treeWidth?: number;
  } = {},
) {
  const doc = await queryClient.fetchQuery({
    queryKey: fileKey(scope, path),
    queryFn: () => readFile(scope, path),
    staleTime: 0,
  });
  if (signal?.aborted) return doc;
  useWindowStore.getState().open({
    kind: "files",
    preview,
    treeWidth,
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

export function relocateOpenFile(scope: FileScope, result: FileActionResult) {
  const previous = result.previousRealPath;
  const previousPath = result.previousPath;
  if (!previous || !previousPath) return;
  const id = scopeId(scope);
  const windows = useWindowStore.getState().windows;
  const matching = (tab: WindowTab) =>
    tab.resourceId === previous && tab.file && scopeId(tab.file.scope) === id;
  if (!windows.some((win) => win.tabs.some(matching))) return;

  const target = result.realPath;
  const state = useFileDraftStore.getState();
  const draft = state.drafts[previous];
  if (draft && state.drafts[target]) return;
  if (draft) {
    state.edit(target, draft.text, draft.baseVersion);
    if (
      !windows.some((win) => win.tabs.some((tab) => tab.resourceId === previous && !matching(tab)))
    )
      state.discard(previous);
  }

  useWindowStore.setState({
    windows: windows.map((win) => {
      const moved = win.tabs.find(matching);
      if (!moved) return win;
      const tabs = win.tabs.filter((tab) => tab.id === moved.id || tab.resourceId !== target);
      return {
        ...win,
        activeTabId: tabs.some((tab) => tab.id === win.activeTabId) ? win.activeTabId : moved.id,
        tabs: tabs.map((tab) =>
          tab.id === moved.id
            ? {
                ...tab,
                resourceId: target,
                viewKey: `file:${target}`,
                title: result.path.split("/").at(-1) ?? result.path,
                file: { scope, path: result.path },
                preview: false,
              }
            : tab,
        ),
      };
    }),
  });
}
