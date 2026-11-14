import type { FileScope } from "@larness/shared";
import { cn, ErrorMessage } from "@larness/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ChevronsDownUp, Copy, FileText, Folder } from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { openFile } from "@/features/files/actions";
import { fileError, listDirectory, scopeId } from "@/features/files/api";
import { QuickOpenFiles } from "@/features/files/QuickOpenFiles";
import { useFileWatch } from "@/features/files/useFileWatch";
import { USE_MOCKS } from "@/lib/env";
import { queryClient, useSnapshot } from "@/lib/queries";
import { activeWorkspaceScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { DemoFileTreePanel } from "./DemoFileTreePanel";

const root = ["."];

export function FileTreePanel({ projectId }: { projectId: string | null }) {
  const sessionId = useNavigationStore((state) => state.sessionId);
  const { data } = useSnapshot();
  if (USE_MOCKS) return <DemoFileTreePanel projectId={projectId} />;
  const scope = activeWorkspaceScope(projectId, sessionId, data.sessions);
  return <RealFileTree key={scopeId(scope)} scope={scope} />;
}

function RealFileTree({ scope }: { scope: FileScope }) {
  const id = scopeId(scope);
  const treeWidth = useNavigationStore((state) => state.resourceWidth);
  const expanded = useNavigationStore((state) => state.expandedFileDirectories[id] ?? root);
  const reveal = useNavigationStore((state) =>
    state.fileReveal?.scope === id ? state.fileReveal : null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const tree = useRef<HTMLFieldSetElement>(null);
  const pendingOpen = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => pendingOpen.current?.abort(), []);
  useFileWatch(scope, expanded);

  const open = (path: string, preview: boolean) => {
    pendingOpen.current?.abort();
    pendingOpen.current = new AbortController();
    const { signal } = pendingOpen.current;
    setError(null);
    void openFile(
      scope,
      path,
      "projectId" in scope ? "project" : "workspace" in scope ? "global" : "session",
      { preview, signal, treeWidth },
    ).catch((error: unknown) => {
      if (!signal.aborted) setError(fileError(error));
    });
  };

  const toggle = (path: string) => {
    const closing = expanded.includes(path);
    if (closing && selected?.startsWith(`${path}/`)) setSelected(path);
    useNavigationStore
      .getState()
      .setExpandedFileDirectories(
        id,
        closing
          ? expanded.filter((item) => item !== path && !item.startsWith(`${path}/`))
          : [...expanded, path],
      );
  };

  const finishReveal = (path: string | null) => {
    if (useNavigationStore.getState().fileReveal !== reveal) return;
    useNavigationStore.setState({ fileReveal: null });
    if (path === null) {
      setError("无法在文件树中定位该文件。");
      return;
    }
    const row = [
      ...(tree.current?.querySelectorAll<HTMLButtonElement>("[data-file-path]") ?? []),
    ].find((node) => node.dataset.filePath === path);
    setError(null);
    setSelected(path);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView?.({ block: "nearest" });
  };

  const handleKeys = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-file-path]");
    if (!row) return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-file-path]")];
    const index = rows.indexOf(row);
    const path = row.dataset.filePath;
    if (!path) return;
    const isFolder = row.hasAttribute("aria-expanded");
    const isExpanded = expanded.includes(path);
    let next: HTMLButtonElement | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = rows[index + 1];
        break;
      case "ArrowUp":
        next = rows[index - 1];
        break;
      case "ArrowLeft":
        if (isFolder && isExpanded) toggle(path);
        else next = rows.find((candidate) => candidate.dataset.filePath === row.dataset.parentPath);
        break;
      case "ArrowRight":
        if (isFolder && !isExpanded) toggle(path);
        else if (rows[index + 1]?.dataset.parentPath === path) next = rows[index + 1];
        break;
      case "Enter":
        if (isFolder) return;
        open(path, false);
        break;
      default:
        return;
    }
    event.preventDefault();
    next?.focus();
  };

  const copyPath = async () => {
    if (!selected) return;
    setError(null);
    setStatus("");
    try {
      await navigator.clipboard.writeText(selected);
      setStatus("已复制相对路径");
    } catch {
      setError("无法复制路径，请检查浏览器的剪贴板权限。");
    }
  };

  return (
    <div className="p-1.5 text-[11px] text-ink-2">
      <div className="mb-1 flex items-center justify-end gap-0.5">
        <span className="mr-auto text-ink-3" role="status">
          {status}
        </span>
        <QuickOpenFiles scope={scope} treeWidth={treeWidth} />
        <button
          type="button"
          aria-label="复制相对路径"
          title="复制相对路径"
          disabled={!selected}
          className="rounded p-1.5 hover:bg-surface-2 disabled:opacity-40"
          onClick={() => void copyPath()}
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          aria-label="全部折叠"
          title="全部折叠"
          disabled={expanded.length === 1}
          className="rounded p-1.5 hover:bg-surface-2 disabled:opacity-40"
          onClick={() => {
            if (selected?.includes("/")) setSelected(null);
            useNavigationStore.getState().setExpandedFileDirectories(id, root);
          }}
        >
          <ChevronsDownUp size={13} />
        </button>
      </div>
      <ErrorMessage message={error} onDismiss={() => setError(null)} />
      <fieldset ref={tree} aria-label="文件树" className="min-w-0" onKeyDown={handleKeys}>
        <Directory
          scope={scope}
          path="."
          depth={0}
          expanded={expanded}
          toggle={toggle}
          selected={selected}
          select={(path) => {
            setSelected(path);
            setStatus("");
          }}
          open={open}
          reveal={reveal?.path ?? null}
          finishReveal={finishReveal}
        />
      </fieldset>
    </div>
  );
}

interface DirectoryProps {
  scope: FileScope;
  path: string;
  depth: number;
  expanded: string[];
  toggle: (path: string) => void;
  selected: string | null;
  select: (path: string) => void;
  open: (path: string, preview: boolean) => void;
  reveal: string | null;
  finishReveal: (path: string | null) => void;
}

function Directory(props: DirectoryProps) {
  const { scope, path, depth, expanded, toggle, selected, select, open, reveal, finishReveal } =
    props;
  const queryKey = ["files", scopeId(scope), "directory", path];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDirectory(scope, path, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];
  const relative =
    path === "." ? reveal : reveal?.startsWith(`${path}/`) && reveal.slice(path.length + 1);
  const nextName = relative ? relative.split("/")[0] : null;
  const match = nextName ? entries.find((entry) => entry.name === nextName) : undefined;
  useLayoutEffect(() => {
    if (!nextName) return;
    if (query.isError) finishReveal(null);
    else if (match) {
      if (match.path === reveal) finishReveal(match.path);
      else if (match.type !== "directory") finishReveal(null);
    } else if (!query.isFetching && query.isSuccess) {
      if (query.hasNextPage) void query.fetchNextPage();
      else finishReveal(null);
    }
  }, [nextName, match, reveal, finishReveal, query]);

  return (
    <>
      {query.isPending ? <p className="p-2 text-ink-3">正在读取目录…</p> : null}
      <ErrorMessage
        message={query.isError ? fileError(query.error) : null}
        retry={{
          label: "重新加载目录",
          run: () => void queryClient.resetQueries({ queryKey }),
        }}
      />
      {entries.map((entry) => {
        const directory = entry.type === "directory";
        const isExpanded = directory && expanded.includes(entry.path);
        return (
          <div key={entry.path}>
            <button
              type="button"
              data-file-path={entry.path}
              data-parent-path={path}
              title={entry.path}
              aria-label={directory ? `目录 ${entry.name}` : `打开文件 ${entry.name}`}
              aria-expanded={directory ? isExpanded : undefined}
              aria-current={selected === entry.path ? true : undefined}
              className={cn(
                "flex h-[26px] w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-accent-soft",
                selected === entry.path && "bg-accent-soft text-accent",
              )}
              style={{ paddingLeft: 6 + depth * 12 }}
              onFocus={() => select(entry.path)}
              onClick={() => {
                select(entry.path);
                if (directory) toggle(entry.path);
                else open(entry.path, true);
              }}
              onDoubleClick={directory ? undefined : () => open(entry.path, false)}
            >
              {directory ? (
                <>
                  {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  <Folder size={13} className="text-warning" />
                </>
              ) : (
                <>
                  <span className="w-[11px]" />
                  <FileText size={13} className="text-ink-3" />
                </>
              )}
              <span className="truncate">{entry.name}</span>
            </button>
            {isExpanded ? <Directory {...props} path={entry.path} depth={depth + 1} /> : null}
          </div>
        );
      })}
      {path === "." && query.isSuccess && !entries.length ? (
        <p className="px-2 py-3 text-[10.5px] text-ink-3">当前工作区暂无文件</p>
      ) : null}
      {query.hasNextPage ? (
        <button
          type="button"
          className="px-3 py-2 text-accent"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多文件
        </button>
      ) : null}
    </>
  );
}
