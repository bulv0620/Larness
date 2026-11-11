import type { FileScope } from "@larness/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
} from "@larness/ui";
import { useEffect, useRef, useState } from "react";
import { useWindowStore } from "@/stores/windowStore";
import { saveDraft } from "./actions";
import { fileError, scopeId } from "./api";
import { useFileDraftStore } from "./drafts";
import { useFileWatch } from "./useFileWatch";

function Watch({ scope, paths }: { scope: FileScope; paths: string[] }) {
  const status = useFileWatch(scope, paths);
  const id = scopeId(scope);
  useEffect(() => {
    useFileDraftStore.setState((state) => ({ monitoring: { ...state.monitoring, [id]: status } }));
  }, [id, status]);
  return (
    <span className="sr-only" role="status">
      {status}
    </span>
  );
}
export function FileLifecycle() {
  const previous = useRef<string[]>([]);
  const windows = useWindowStore((state) => state.windows);
  const drafts = useFileDraftStore((state) => state.drafts);
  const request = useFileDraftStore((state) => state.closeRequest);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const groups = new Map<string, { scope: FileScope; paths: string[] }>();
  for (const win of windows)
    for (const tab of win.tabs) {
      if (!tab.file) continue;
      const id = scopeId(tab.file.scope);
      const group = groups.get(id) ?? { scope: tab.file.scope, paths: [] };
      group.paths.push(tab.file.path);
      groups.set(id, group);
    }
  useEffect(() => {
    const current = windows.flatMap((win) =>
      win.tabs.filter((tab) => tab.file).map((tab) => tab.resourceId),
    );
    const removed = previous.current.filter((key) => !current.includes(key));
    if (removed.length)
      void import("./FileEditor").then(({ disposeFileModel }) => {
        for (const key of removed) {
          if (
            !useWindowStore
              .getState()
              .windows.some((win) => win.tabs.some((tab) => tab.file && tab.resourceId === key))
          )
            disposeFileModel(key);
        }
      });
    previous.current = current;
  }, [windows]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (Object.keys(useFileDraftStore.getState().drafts).length) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);
  const tab = request
    ? windows
        .find((win) => win.id === request.windowId)
        ?.tabs.find((tab) => tab.id === request.tabId)
    : undefined;
  const dismiss = () => {
    useFileDraftStore.setState({ closeRequest: null });
    setError(null);
  };
  const close = () => {
    if (!request || !tab) return;
    useFileDraftStore.getState().discard(tab.resourceId);
    useWindowStore.getState().closeTab(request.windowId, request.tabId);
    dismiss();
  };
  return (
    <>
      {[...groups].map(([id, group]) => (
        <Watch key={id} {...group} />
      ))}
      {request && tab && drafts[tab.resourceId] ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !saving) dismiss();
          }}
        >
          <DialogContent className="pointer-events-auto space-y-4 text-sm">
            <DialogTitle>未保存的文件</DialogTitle>
            <DialogDescription>{tab.title} 有未保存的改动。</DialogDescription>
            <ErrorMessage message={error} onDismiss={() => setError(null)} />
            <div className="flex gap-3">
              <Button
                type="button"
                disabled={saving}
                onClick={() => {
                  setSaving(true);
                  void saveDraft(tab)
                    .then(close)
                    .catch((error: unknown) => setError(fileError(error)))
                    .finally(() => setSaving(false));
                }}
              >
                保存并关闭
              </Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={close}>
                放弃改动
              </Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={dismiss}>
                取消
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
