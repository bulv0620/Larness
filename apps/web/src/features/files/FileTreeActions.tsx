import type { FileScope } from "@larness/shared";
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
  Input,
} from "@larness/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Folder } from "lucide-react";
import { type ComponentPropsWithoutRef, cloneElement, type ReactElement, useState } from "react";
import { fileError, listDirectory, scopeId } from "./api";

export function FileRowActions({
  children,
  rename,
  move,
  remove,
}: {
  children: ReactElement<ComponentPropsWithoutRef<"button">>;
  rename: () => void;
  move: () => void;
  remove?: () => void;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const show = (x: number, y: number) => {
    setAnchor({ x, y });
    setOpen(true);
  };

  return (
    <>
      {cloneElement(children, {
        onContextMenu: (event) => {
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          show(event.clientX, event.clientY);
        },
        onKeyDown: (event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          const rect = event.currentTarget.getBoundingClientRect();
          event.preventDefault();
          show(rect.left, rect.bottom);
        },
      })}
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed size-px"
            style={{ left: anchor?.x, top: anchor?.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          sideOffset={0}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onSelect={rename}>重命名</DropdownMenuItem>
          <DropdownMenuItem onSelect={move}>移动到…</DropdownMenuItem>
          {remove ? (
            <DropdownMenuItem onSelect={remove} className="text-danger">
              删除…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function FileNameInput({
  label,
  initial,
  busy,
  submit,
  cancel,
}: {
  label: string;
  initial: string;
  busy: boolean;
  submit: (name: string) => void;
  cancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="min-w-0 flex-1 px-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && name.trim()) submit(name.trim());
      }}
    >
      <Input
        ref={(node) => {
          if (node) node.focus();
        }}
        className="h-7 px-1.5 text-xs"
        aria-label={label}
        placeholder={label}
        value={name}
        maxLength={255}
        readOnly={busy}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.stopPropagation();
            cancel();
          }
        }}
      />
    </form>
  );
}

export function MoveFileDialog({
  scope,
  source,
  busy,
  error,
  move,
  close,
}: {
  scope: FileScope;
  source: string;
  busy: boolean;
  error: string | null;
  move: (directory: string) => void;
  close: () => void;
}) {
  const [directory, setDirectory] = useState(".");
  const query = useInfiniteQuery({
    queryKey: ["files", scopeId(scope), "directory", directory],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDirectory(scope, directory, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="space-y-3">
        <DialogTitle>移动文件</DialogTitle>
        <DialogDescription className="break-all">{source}</DialogDescription>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="truncate">{directory === "." ? "工作区根目录" : directory}</span>
          {directory !== "." ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/") || ".")}
            >
              返回上级
            </Button>
          ) : null}
        </div>
        <div className="max-h-[40vh] overflow-auto">
          {query.data?.pages
            .flatMap((page) => page.items)
            .filter((item) => item.type === "directory")
            .map((item) => (
              <button
                key={item.path}
                type="button"
                disabled={busy}
                onClick={() => setDirectory(item.path)}
                className="flex w-full items-center gap-2 rounded p-2 text-left text-xs hover:bg-surface-2"
              >
                <Folder size={14} className="text-warning" />
                {item.name}
              </button>
            ))}
          {query.hasNextPage ? (
            <button
              type="button"
              disabled={busy || query.isFetchingNextPage}
              className="p-2 text-xs text-accent"
              onClick={() => void query.fetchNextPage()}
            >
              加载更多
            </button>
          ) : null}
        </div>
        {query.isPending ? (
          <p role="status" className="text-xs">
            正在读取目录…
          </p>
        ) : null}
        {error || query.isError ? (
          <p role="alert" className="text-xs text-danger">
            {error ?? fileError(query.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              !query.isSuccess ||
              source.split("/").slice(0, -1).join("/") === (directory === "." ? "" : directory)
            }
            onClick={() => move(directory)}
          >
            {busy ? "正在移动…" : "移到这里"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteFileDialog({
  path,
  busy,
  error,
  stale,
  remove,
  close,
}: {
  path: string;
  busy: boolean;
  error: string | null;
  stale: boolean;
  remove: () => void;
  close: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="space-y-3">
        <DialogTitle>删除文件</DialogTitle>
        <DialogDescription>
          将永久删除 <span className="break-all font-mono text-ink">{path}</span>。
        </DialogDescription>
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            type="button"
            className="bg-danger text-white"
            disabled={busy || stale}
            onClick={remove}
          >
            {busy ? "正在删除…" : "确认删除"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
