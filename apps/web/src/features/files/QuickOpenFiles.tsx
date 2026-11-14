import type { FileScope } from "@larness/shared";
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@larness/ui";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { openFile } from "./actions";
import { fileError, scopeId, searchFiles } from "./api";

export function QuickOpenFiles({ scope, treeWidth }: { scope: FileScope; treeWidth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="快速打开文件"
          title="快速打开文件"
          className="rounded p-1.5 hover:bg-surface-2"
        >
          <Search size={13} />
        </button>
      </DialogTrigger>
      {open ? (
        <FileSearch scope={scope} treeWidth={treeWidth} close={() => setOpen(false)} />
      ) : null}
    </Dialog>
  );
}

function FileSearch({
  scope,
  treeWidth,
  close,
}: {
  scope: FileScope;
  treeWidth: number;
  close: () => void;
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
    <DialogContent className="top-[12vh] bottom-auto mx-auto max-h-[76vh] p-3">
      <DialogTitle className="sr-only">快速打开文件</DialogTitle>
      <DialogDescription className="sr-only">
        搜索当前工作区。使用方向键选择，Enter 打开。
      </DialogDescription>
      <Input
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
      {error || (current === term && query.isError) ? (
        <p className="px-2 pt-2 text-xs text-danger" role="alert">
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
        className="mt-1 max-h-[55vh] overflow-y-auto"
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
              "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
              row === index ? "bg-accent-soft text-accent" : "hover:bg-surface-2",
            )}
            onPointerMove={() => setSelected(row)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(item.path)}
          >
            <FileText size={14} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate">{item.name}</span>
            <span className="ml-auto min-w-0 truncate text-ink-3">
              {item.path.split("/").slice(0, -1).join("/") || "."}
            </span>
          </button>
        ))}
      </div>
      {current ? (
        <p role="status" className="px-2 text-[11px] text-ink-3">
          {opening
            ? "正在打开文件…"
            : current !== term || query.isFetching
              ? "正在搜索…"
              : query.data?.partial
                ? "结果受限，请缩小关键词。"
                : query.isSuccess && !items.length
                  ? "没有匹配的文件。"
                  : ""}
        </p>
      ) : null}
    </DialogContent>
  );
}
