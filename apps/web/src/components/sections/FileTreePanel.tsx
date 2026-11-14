import type { FileAction, FileScope } from "@larness/shared";
import { cn, ErrorMessage } from "@larness/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  FilePlus2,
  Folder,
  FolderPlus,
  Search,
} from "lucide-react";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import { openFile, relocateOpenFile } from "@/features/files/actions";
import { applyFileAction, fileError, listDirectory, readFile, scopeId } from "@/features/files/api";
import { useFileDraftStore } from "@/features/files/drafts";
import { FileNameInput, FileRowActions, MoveFileDialog } from "@/features/files/FileTreeActions";
import { FileTypeIcon } from "@/features/files/FileTypeIcon";
import { useFileWatch } from "@/features/files/useFileWatch";
import { ApiError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import { queryClient, useSnapshot } from "@/lib/queries";
import { activeWorkspaceScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { DemoFileTreePanel } from "./DemoFileTreePanel";

const root = ["."];
type Edit = { action: "createFile" | "createDirectory" | "rename" | "move"; path: string };
const parentPath = (path: string) => path.split("/").slice(0, -1).join("/") || ".";
const childPath = (parent: string, name: string) => (parent === "." ? name : `${parent}/${name}`);

export function FileTreePanel({
  projectId,
  onQuickOpen,
}: {
  projectId: string | null;
  onQuickOpen?: () => void;
}) {
  const sessionId = useNavigationStore((state) => state.sessionId);
  const { data } = useSnapshot();
  if (USE_MOCKS) return <DemoFileTreePanel projectId={projectId} />;
  const scope = activeWorkspaceScope(projectId, sessionId, data.sessions);
  return <RealFileTree key={scopeId(scope)} scope={scope} onQuickOpen={onQuickOpen} />;
}

function RealFileTree({ scope, onQuickOpen }: { scope: FileScope; onQuickOpen?: () => void }) {
  const id = scopeId(scope);
  const treeWidth = useNavigationStore((state) => state.resourceWidth);
  const expanded = useNavigationStore((state) => state.expandedFileDirectories[id] ?? root);
  const reveal = useNavigationStore((state) =>
    state.fileReveal?.scope === id ? state.fileReveal : null,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const mutation = useRef(false);
  const request = useRef<{ value: string; input: FileAction; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const tree = useRef<HTMLFieldSetElement>(null);
  const pendingOpen = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pendingOpen.current?.abort();
    };
  }, []);
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

  const begin = (next: Edit) => {
    if (mutation.current) return;
    setError(null);
    request.current = null;
    setEdit(next);
  };

  const startCreate = (action: "createFile" | "createDirectory") => {
    const selectedRow = [
      ...(tree.current?.querySelectorAll<HTMLButtonElement>("[data-file-path]") ?? []),
    ].find((row) => row.dataset.filePath === selected);
    const path =
      selected && selectedRow
        ? selectedRow.hasAttribute("aria-expanded")
          ? selected
          : parentPath(selected)
        : ".";
    useNavigationStore.getState().setExpandedFileDirectories(id, [...new Set([...expanded, path])]);
    begin({ action, path });
  };

  const submit = async (value: string) => {
    if (!edit || mutation.current) return;
    if (
      edit.action !== "move" &&
      (!value || /[\\/:]/.test(value) || value === "." || value === "..")
    ) {
      setError("请输入一个有效的名称。");
      return;
    }
    mutation.current = true;
    setBusy(true);
    setError(null);
    const action = edit.action;
    try {
      let input: FileAction;
      if (request.current?.value === value) input = request.current.input;
      else if (action === "rename" || action === "move") {
        const file = await readFile(scope, edit.path);
        const drafts = useFileDraftStore.getState();
        if (drafts.saving[file.realPath]) {
          setError("正在保存该文件，请稍后重试。");
          return;
        }
        const destination =
          action === "rename"
            ? childPath(parentPath(edit.path), value)
            : childPath(value, edit.path.split("/").at(-1) ?? edit.path);
        const portablePath = file.realPath.replaceAll("\\", "/");
        const target = `${portablePath.slice(0, -file.path.length)}${destination}`;
        if (destination === edit.path) {
          setEdit(null);
          return;
        }
        if (Object.keys(drafts.drafts).some((key) => key.replaceAll("\\", "/") === target)) {
          setError("目标路径有未保存的草稿，请先处理该草稿。");
          return;
        }
        input = {
          scope,
          action: "move",
          path: edit.path,
          destination,
          expectedVersion: drafts.drafts[file.realPath]?.baseVersion ?? file.version,
        };
      } else input = { scope, action, path: childPath(edit.path, value) };
      if (request.current?.value !== value)
        request.current = { value, input, key: crypto.randomUUID() };
      const result = await applyFileAction(input, request.current.key);
      if (input.action === "move") relocateOpenFile(scope, result);
      await queryClient.resetQueries({ queryKey: ["files", id, "directory"] });
      void queryClient.invalidateQueries({ queryKey: ["file-search", id] });
      if (!mounted.current) return;
      setEdit(null);
      useNavigationStore.getState().revealFile(id, result.path);
      if (action === "createFile") open(result.path, false);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) request.current = null;
      if (mounted.current) setError(fileError(error));
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(false);
    }
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
    next?.focus({ preventScroll: true });
    next?.scrollIntoView?.({ block: "nearest" });
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
      <div className="relative">
        <span className="absolute top-2.5 left-0 text-ink-3" role="status">
          {status}
        </span>
      </div>
      <div
        role="toolbar"
        aria-label="文件操作"
        className="file-tree-toolbar sticky top-0 isolate z-10 -mt-1.5 -mr-1.5 mb-1 ml-auto flex w-fit min-h-9 items-center gap-0.5 px-1.5"
      >
        <button
          type="button"
          aria-label="新建文件"
          title="新建文件"
          disabled={busy}
          className="rounded p-1.5 hover:bg-surface-2"
          onClick={() => startCreate("createFile")}
        >
          <FilePlus2 size={13} />
        </button>
        <button
          type="button"
          aria-label="新建目录"
          title="新建目录"
          disabled={busy}
          className="rounded p-1.5 hover:bg-surface-2"
          onClick={() => startCreate("createDirectory")}
        >
          <FolderPlus size={13} />
        </button>
        {onQuickOpen ? (
          <button
            type="button"
            aria-label="快速打开文件"
            aria-keyshortcuts="Meta+P Control+P"
            title="快速打开文件（⌘P / Ctrl+P）"
            className="rounded p-1.5 hover:bg-surface-2"
            onClick={onQuickOpen}
          >
            <Search size={13} />
          </button>
        ) : null}
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
      <ErrorMessage
        message={edit?.action === "move" ? null : error}
        onDismiss={() => setError(null)}
      />
      {edit?.action === "move" ? (
        <MoveFileDialog
          scope={scope}
          source={edit.path}
          busy={busy}
          error={error}
          move={(path) => void submit(path)}
          close={() => setEdit(null)}
        />
      ) : null}
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
          edit={edit}
          busy={busy}
          begin={begin}
          submit={(value) => void submit(value)}
          cancel={() => setEdit(null)}
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
  edit: Edit | null;
  busy: boolean;
  begin: (edit: Edit) => void;
  submit: (name: string) => void;
  cancel: () => void;
}

function Directory(props: DirectoryProps) {
  const {
    scope,
    path,
    depth,
    expanded,
    toggle,
    selected,
    select,
    open,
    reveal,
    finishReveal,
    edit,
    busy,
    begin,
    submit,
    cancel,
  } = props;
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
      {edit?.path === path &&
      (edit.action === "createFile" || edit.action === "createDirectory") ? (
        <div style={{ paddingLeft: 6 + depth * 12 }}>
          <FileNameInput
            key={edit.action}
            label={edit.action === "createFile" ? "新文件名" : "新目录名"}
            initial=""
            busy={busy}
            submit={submit}
            cancel={cancel}
          />
        </div>
      ) : null}
      {entries.map((entry) => {
        const directory = entry.type === "directory";
        const isExpanded = directory && expanded.includes(entry.path);
        const row = (
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
                <FileTypeIcon path={entry.path} />
              </>
            )}
            <span className="truncate">{entry.name}</span>
          </button>
        );
        return (
          <div key={entry.path}>
            {edit?.action === "rename" && edit.path === entry.path ? (
              <div className="min-w-0" style={{ paddingLeft: 6 + depth * 12 }}>
                <FileNameInput
                  label="新名称"
                  initial={entry.name}
                  busy={busy}
                  submit={submit}
                  cancel={cancel}
                />
              </div>
            ) : directory ? (
              row
            ) : (
              <FileRowActions
                rename={() => begin({ action: "rename", path: entry.path })}
                move={() => begin({ action: "move", path: entry.path })}
              >
                {row}
              </FileRowActions>
            )}
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
