import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
  Input,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronUp, Folder, FolderPlus, Home, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { operationError } from "@/lib/api";
import { createProject, type DirectoryListing, listDirectories } from "@/lib/workspaceApi";

export function ProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [rootPath, setRootPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loadingListing, setLoadingListing] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);

  const browse = useCallback(async (directory?: string): Promise<void> => {
    setLoadingListing(true);
    setListingError(null);

    try {
      setListing(await listDirectories(directory));
    } catch (browseError) {
      setListingError(operationError(browseError, "无法读取目录"));
    } finally {
      setLoadingListing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setRootPath("");
      setName("");
      setError(null);
      setBusy(false);
      setListing(null);
      setListingError(null);
      return;
    }

    void browse();
  }, [browse, open]);

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
      setError(operationError(submitError, "添加项目失败"));
    } finally {
      setBusy(false);
    }
  };

  const chooseCurrent = (): void => {
    if (listing === null) return;
    setRootPath(listing.path);
    if (!name.trim()) {
      setName(listing.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(640px,calc(100vw-40px))]">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderPlus size={15} />
          </span>
          <div>
            <DialogTitle>添加项目</DialogTitle>
            <DialogDescription>
              浏览本机目录并选择项目根目录；不会复制或删除源码。
            </DialogDescription>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-surface-2/40">
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
            <button
              type="button"
              aria-label="上一级"
              title="上一级"
              disabled={listing === null || listing.parent === null || loadingListing}
              onClick={() => listing?.parent && void browse(listing.parent)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
            >
              <ChevronUp size={13} />
            </button>
            <button
              type="button"
              aria-label="主目录"
              title="主目录"
              disabled={loadingListing}
              onClick={() => void browse(listing?.home)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
            >
              <Home size={12} />
            </button>
            <button
              type="button"
              aria-label="刷新目录"
              title="刷新"
              disabled={loadingListing}
              onClick={() => void browse(listing?.path)}
              className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
            >
              <RefreshCw size={12} />
            </button>
            <span className="min-w-0 flex-1 truncate px-1 font-mono text-[10.5px] text-ink-2">
              {listing?.path ?? (listingError ? "目录不可用" : "读取中…")}
            </span>
          </div>

          <div className="h-[230px] overflow-auto p-1.5">
            {loadingListing ? (
              <div className="flex h-full items-center justify-center gap-1.5 text-[11px] text-ink-3">
                <Loader2 size={12} className="animate-spin" /> 正在读取目录…
              </div>
            ) : listing?.entries.length === 0 ? (
              <p className="px-2 py-3 text-[11px] text-ink-3">没有子目录</p>
            ) : (
              listing?.entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => void browse(entry.path)}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-ink-2 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
                >
                  <Folder size={13} className="shrink-0 text-accent/80" />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </button>
              ))
            )}
            {listing?.truncated ? (
              <p className="px-2 py-1 text-[10px] text-warning">目录过多，仅显示前 500 项</p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">
              {rootPath || "尚未选择项目目录"}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={listing === null || loadingListing}
              onClick={chooseCurrent}
            >
              选择当前目录
            </Button>
          </div>
        </div>

        <label
          htmlFor={`${fieldId}-directory`}
          className="mt-3 block text-[11px] font-medium text-ink-2"
        >
          项目目录（也可直接粘贴绝对路径）
          <Input
            id={`${fieldId}-directory`}
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            aria-label="项目目录"
            placeholder="/Users/me/project"
            spellCheck={false}
            className="mt-1.5 h-9 font-mono text-[11.5px]"
          />
        </label>

        <label
          htmlFor={`${fieldId}-name`}
          className="mt-2.5 block text-[11px] font-medium text-ink-2"
        >
          显示名称（可选）
          <Input
            id={`${fieldId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="默认取目录名"
            className="mt-1.5 h-9 text-[11.5px]"
          />
        </label>

        <ErrorMessage
          message={error ?? listingError}
          onDismiss={error ? () => setError(null) : undefined}
        />

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
