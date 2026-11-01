import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { createProject } from "@/lib/workspaceApi";

export function ProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setRootPath("");
      setName("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    if (!rootPath.trim()) return;
    setBusy(true);
    setError(null);

    try {
      await createProject({
        rootPath: rootPath.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "添加项目失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderPlus size={15} />
          </span>
          <div>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>登记本机已有目录；不会复制或删除源码。</DialogDescription>
          </div>
        </div>

        <label className="mt-4 block text-[11px] font-medium text-ink-2">
          目录路径
          <input
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            placeholder="/Users/me/project"
            spellCheck={false}
            className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 font-mono text-[11.5px] text-ink outline-none focus:border-accent/40"
          />
        </label>

        <label className="mt-3 block text-[11px] font-medium text-ink-2">
          显示名称（可选）
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="默认取目录名"
            className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface-2 px-2.5 text-[11.5px] text-ink outline-none focus:border-accent/40"
          />
        </label>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-danger/10 px-2.5 py-2 text-[11px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !rootPath.trim()}
            onClick={() => void submit()}
          >
            {busy ? "正在添加…" : "添加项目"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
