import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useEffect, useState } from "react";
import { saveDraft } from "@/features/files/actions";
import { useFileDraftStore } from "@/features/files/drafts";
import { useWindowStore } from "@/stores/windowStore";

export function WindowCloseDialog() {
  const request = useWindowStore((state) => state.closeRequest);
  return request ? <CloseRequest key={JSON.stringify(request)} request={request} /> : null;
}
function CloseRequest({ request }: { request: { windowId: string; tabIds: string[] } }) {
  const windows = useWindowStore((state) => state.windows);
  const drafts = useFileDraftStore((state) => state.drafts);
  const saving = useFileDraftStore((state) => state.saving);
  const [confirmed, setConfirmed] = useState(request.tabIds.length <= 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tabs =
    windows
      .find((win) => win.id === request.windowId)
      ?.tabs.filter((tab) => request.tabIds.includes(tab.id)) ?? [];
  const dirty = tabs.find((tab) => tab.file && drafts[tab.resourceId]);
  const blocked = busy || tabs.some((tab) => saving[tab.resourceId]);
  const dismiss = () => useWindowStore.setState({ closeRequest: null });
  useEffect(() => {
    if (!confirmed || dirty || blocked) return;
    for (const tab of tabs) useWindowStore.getState().closeTab(request.windowId, tab.id);
    useWindowStore.setState({ closeRequest: null });
  }, [confirmed, dirty, blocked, tabs, request.windowId]);
  if (confirmed && !dirty) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !blocked) dismiss();
      }}
    >
      <DialogContent
        className="pointer-events-auto space-y-4 text-sm"
        onEscapeKeyDown={(event) => {
          if (blocked) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (blocked) event.preventDefault();
        }}
      >
        <DialogTitle>{confirmed ? "未保存的文件" : `关闭 ${tabs.length} 个 Tab？`}</DialogTitle>
        <DialogDescription>
          {confirmed
            ? `${dirty?.title ?? "文件"} 有未保存的改动。`
            : "最小化可以保留这些 Tab，关闭后需要重新打开。"}
        </DialogDescription>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={blocked} onClick={dismiss}>
            取消
          </Button>
          {!confirmed ? (
            <Button onClick={() => setConfirmed(true)}>关闭全部 Tab</Button>
          ) : dirty ? (
            <>
              <Button
                variant="secondary"
                disabled={blocked}
                onClick={() => {
                  useFileDraftStore.getState().discard(dirty.resourceId);
                  setError("");
                }}
              >
                放弃改动并继续
              </Button>
              <Button
                disabled={blocked}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  void saveDraft(dirty)
                    .then(() => {
                      if (useFileDraftStore.getState().drafts[dirty.resourceId])
                        setError("文件在保存期间有新改动，请再次保存。");
                    })
                    .catch(() => setError("保存失败，已保留文件和草稿，请核对后重试。"))
                    .finally(() => setBusy(false));
                }}
              >
                保存并继续
              </Button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
