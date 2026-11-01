import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { updateSession } from "@/lib/workspaceApi";

export function RenameSessionDialog({
  session,
  open,
  onClose,
}: {
  session: { id: string; title: string } | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(session?.title ?? "");
    setError(null);
    setBusy(false);
  }, [session]);

  const submit = async (): Promise<void> => {
    if (session === null || !title.trim()) return;
    setBusy(true);
    setError(null);

    try {
      await updateSession(session.id, { title: title.trim() });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open && session !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle>重命名会话</DialogTitle>
        <DialogDescription>标题只用于展示，不参与授权。</DialogDescription>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="会话标题"
          autoFocus
          className="mt-4 h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] text-ink outline-none focus:border-accent/40"
        />
        {error ? (
          <p role="alert" className="mt-2 text-[11px] text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !title.trim()}
            onClick={() => void submit()}
          >
            {busy ? "正在保存…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
