import type { FileScope } from "@larness/shared";
import { cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from "@larness/ui";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { openFile } from "./actions";
import { fileError, scopeId, searchFiles } from "./api";

export function QuickOpenFiles({
  scope,
  treeWidth,
  open,
  close,
  restoreFocus,
}: {
  scope: FileScope;
  treeWidth?: number;
  open: boolean;
  close: () => void;
  restoreFocus: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {open ? (
        <FileSearch scope={scope} treeWidth={treeWidth} close={close} restoreFocus={restoreFocus} />
      ) : null}
    </Dialog>
  );
}

function FileSearch({
  scope,
  treeWidth,
  close,
  restoreFocus,
}: {
  scope: FileScope;
  treeWidth?: number;
  close: () => void;
  restoreFocus: () => void;
}) {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState(0);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const pendingOpen = useRef<AbortController | null>(null);
  const listId = useId();
  const current = input.trim();
  useLayoutEffect(() => () => pendingOpen.current?.abort(), []);
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(current), 160);
    return () => window.clearTimeout(timer);
  }, [current]);

  const query = useQuery({
    queryKey: ["file-search", scopeId(scope), term],
    queryFn: ({ signal }) => searchFiles(scope, term, signal),
    enabled: current !== "" && current === term,
    retry: false,
    gcTime: 30_000,
  });
  const items = current === term ? (query.data?.items ?? []) : [];
  const index = Math.min(selected, items.length - 1);
  const active = items[index];
  const optionId = active ? `${listId}-${index}` : undefined;
  useEffect(() => {
    if (optionId) document.getElementById(optionId)?.scrollIntoView?.({ block: "nearest" });
  }, [optionId]);

  const choose = (path: string) => {
    if (pendingOpen.current) return;
    pendingOpen.current = new AbortController();
    const { signal } = pendingOpen.current;
    setError("");
    setOpening(true);
    void openFile(
      scope,
      path,
      "projectId" in scope ? "project" : "sessionId" in scope ? "session" : "global",
      { signal, treeWidth },
    )
      .then(close)
      .catch((error: unknown) => {
        if (!signal.aborted) setError(fileError(error));
      })
      .finally(() => {
        if (signal.aborted) return;
        pendingOpen.current = null;
        setOpening(false);
      });
  };

  return (
    <DialogContent
      overlayClassName="bg-black/10 backdrop-blur-[3px] dark:bg-black/30"
      className="top-[min(15dvh,140px)] bottom-auto mx-auto max-h-[76dvh] w-[min(640px,calc(100vw-28px))] overflow-hidden rounded-[22px] border-white/60 bg-surface/90 p-0 shadow-[0_24px_80px_-16px_rgb(0_0_0/0.38)] backdrop-blur-2xl dark:border-white/12"
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        restoreFocus();
      }}
    >
      <DialogTitle className="sr-only">快速打开文件</DialogTitle>
      <DialogDescription className="sr-only">
        搜索当前工作区。使用方向键选择，Enter 打开。
      </DialogDescription>
      <div className="flex h-16 items-center gap-3 px-4 sm:h-[72px] sm:px-5">
        <Search size={24} aria-hidden="true" className="shrink-0 text-ink-3" />
        <Input
          variant="bare"
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink outline-none sm:text-xl"
          role="combobox"
          aria-label="文件名或相对路径"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={items.length > 0}
          aria-activedescendant={optionId}
          placeholder="输入文件名或相对路径"
          maxLength={128}
          readOnly={opening}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setSelected(0);
            setError("");
          }}
          onKeyDown={(event) => {
            if (!active || event.nativeEvent.isComposing) return;
            switch (event.key) {
              case "ArrowDown":
                setSelected((index + 1) % items.length);
                break;
              case "ArrowUp":
                setSelected((index + items.length - 1) % items.length);
                break;
              case "Enter":
                choose(active.path);
                break;
              default:
                return;
            }
            event.preventDefault();
          }}
        />
        <button
          type="button"
          aria-label="关闭快速打开"
          title="关闭快速打开"
          onClick={close}
          className="shrink-0 rounded-md border border-line bg-surface-2/70 px-1.5 py-0.5 font-mono text-[10px] text-ink-3 hover:text-ink"
        >
          Esc
        </button>
      </div>
      {error || (current === term && query.isError) ? (
        <p className="border-t border-line px-5 py-3 text-xs text-danger" role="alert">
          {error || "搜索文件失败，请修改关键词或重试。"}
          {!error ? (
            <button type="button" className="ml-2 text-accent" onClick={() => void query.refetch()}>
              重试
            </button>
          ) : null}
        </p>
      ) : null}
      <div
        id={listId}
        role="listbox"
        aria-label="匹配的文件"
        className={cn(
          "max-h-[min(55dvh,420px)] overflow-y-auto",
          items.length > 0 && "my-2 border-t border-line px-2 pt-2",
        )}
      >
        {items.map((item, row) => (
          <button
            key={item.path}
            type="button"
            role="option"
            tabIndex={-1}
            id={`${listId}-${row}`}
            aria-selected={row === index}
            aria-disabled={opening}
            title={item.path}
            className={cn(
              "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2 text-left",
              row === index ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
            )}
            onPointerMove={() => setSelected(row)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item.path)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-2 text-ink-3">
              <FileText size={16} aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{item.name}</span>
              <span className="truncate text-[11px] text-ink-3">
                {item.path.split("/").slice(0, -1).join("/") || "."}
              </span>
            </span>
            {row === index ? (
              <span aria-hidden="true" className="text-xs text-ink-3">
                ↵
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {current &&
      !error &&
      (opening ||
        current !== term ||
        query.isFetching ||
        query.data?.partial ||
        (query.isSuccess && !items.length)) ? (
        <p role="status" className="border-t border-line px-5 py-2.5 text-[11px] text-ink-3">
          {opening
            ? "正在打开文件…"
            : current !== term || query.isFetching
              ? "正在搜索…"
              : query.data?.partial
                ? "结果受限，请缩小关键词。"
                : "没有匹配的文件。"}
        </p>
      ) : null}
    </DialogContent>
  );
}
