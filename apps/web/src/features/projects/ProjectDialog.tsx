import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  ErrorMessage,
  Input,
} from "@larness/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useId, useState } from "react";
import { operationError } from "@/lib/api";
import { createProject, listDirectories } from "@/lib/workspaceApi";

export function ProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-24px)] w-[min(640px,calc(100vw-40px))] overflow-y-auto">
        <ProjectForm onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ onClose }: { onClose: () => void }) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [directory, setDirectory] = useState<string>();
  const [manualPath, setManualPath] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    data: listing,
    error: browseError,
    isFetching: loadingListing,
    refetch,
  } = useQuery({
    queryKey: ["project-directories", directory],
    queryFn: () => listDirectories(directory),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const listingError = browseError ? operationError(browseError, "无法读取目录") : null;
  const roots = listing?.roots ?? [];
  const rootPath = manualPath ?? (directory && !listingError ? (listing?.path ?? "") : "");
  const canSubmit = Boolean(rootPath.trim()) && !busy && (manualPath !== null || !loadingListing);

  function browse(nextDirectory?: string): void {
    setManualPath(null);
    setError(null);
    if (nextDirectory === directory) {
      void refetch();
    } else {
      setDirectory(nextDirectory);
    }
  }

  const submit = async (): Promise<void> => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);

    try {
      await createProject({
        rootPath: rootPath.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      onClose();
    } catch (submitError) {
      setError(operationError(submitError, "添加项目失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <FolderPlus size={15} />
        </span>
        <div>
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription>选择项目目录，然后填写显示名称。</DialogDescription>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-surface-2/40">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          <button
            type="button"
            aria-label="上一级"
            title="上一级"
            disabled={!listing?.parent || loadingListing}
            onClick={() => listing?.parent && browse(listing.parent)}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            aria-label="主目录"
            title="主目录"
            disabled={loadingListing}
            onClick={() => browse(listing?.home)}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
          >
            <Home size={12} />
          </button>
          <button
            type="button"
            aria-label="刷新目录"
            title="刷新"
            disabled={loadingListing}
            onClick={() => void refetch()}
            className="flex h-6 w-6 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink disabled:opacity-40 dark:hover:bg-white/[.08]"
          >
            <RefreshCw size={12} />
          </button>
          {roots.length > 0 && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" disabled={loadingListing}>
                  <HardDrive size={13} />
                  磁盘与卷
                  <ChevronDown size={12} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="z-[302] max-h-60 max-w-72 overflow-auto"
              >
                {roots.map((root) => (
                  <DropdownMenuItem key={root.path} onSelect={() => browse(root.path)}>
                    <HardDrive size={13} className="shrink-0" />
                    <span className="truncate" title={root.path}>
                      {root.name}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <span className="min-w-0 flex-1 truncate px-1 font-mono text-[10.5px] text-ink-2">
            {listing?.path ?? (listingError ? "目录不可用" : "读取中…")}
          </span>
        </div>

        <div className="h-[230px] overflow-auto p-1.5">
          {loadingListing ? (
            <div className="flex h-full items-center justify-center gap-1.5 text-[11px] text-ink-3">
              <Loader2 size={12} className="animate-spin" /> 正在读取目录…
            </div>
          ) : listingError ? null : listing?.entries.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-ink-3">没有子目录</p>
          ) : (
            listing?.entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => browse(entry.path)}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11.5px] text-ink-2 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
              >
                <Folder size={13} className="shrink-0 text-accent/80" />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
            ))
          )}
          {!loadingListing && !listingError && listing?.truncated ? (
            <p className="px-2 py-1 text-[10px] text-warning">目录过多，仅显示前 500 项</p>
          ) : null}
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
          onChange={(event) => setManualPath(event.target.value)}
          aria-label="项目目录"
          placeholder="粘贴目录的绝对路径"
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
        <Button variant="secondary" size="sm" onClick={onClose}>
          取消
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
          {busy ? "正在添加…" : "添加项目"}
        </Button>
      </div>
    </form>
  );
}
