import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { updateProject } from "@/lib/workspaceApi";

export function RenameProjectDialog({
  project,
  open,
  onClose,
}: {
  project: { id: string; name: string } | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(project?.name ?? "");
    setError(null);
    setBusy(false);
  }, [project]);

  const submit = async (): Promise<void> => {
    if (project === null || !name.trim()) return;
    setBusy(true);
    setError(null);

    try {
      await updateProject(project.id, { name: name.trim() });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "重命名失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open && project !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle>重命名项目</DialogTitle>
        <DialogDescription>只改变展示名称，不移动或重命名本地目录。</DialogDescription>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="项目名称"
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
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
          >
            {busy ? "正在保存…" : "保存"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
