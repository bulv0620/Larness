import { GIT_BATCH_PATH_LIMIT } from "@larness/shared";
import { ChevronRight, FileCode2, Folder, Minus, Plus, Undo2 } from "lucide-react";
import { useState } from "react";
export interface GitTreeChange {
  path: string;
  status: string;
  staged: boolean;
  origPath?: string | null;
}
interface Node {
  folders: Map<string, Node>;
  files: GitTreeChange[];
}
function node(): Node {
  return { folders: new Map(), files: [] };
}
function tree(changes: GitTreeChange[]) {
  const root = node();
  for (const change of changes) {
    let current = root;
    for (const part of change.path.split("/").slice(0, -1)) {
      if (!current.folders.has(part)) current.folders.set(part, node());
      const next = current.folders.get(part);
      if (next) current = next;
    }
    current.files.push(change);
  }
  return root;
}
const letters: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "U",
  conflicted: "!",
};
const rowLabelClass =
  "grid min-h-6 min-w-0 flex-1 grid-cols-[11px_13px_minmax(0,1fr)] items-center gap-1.5 text-left";

function collectPaths(current: Node, staged: boolean): string[] {
  return [
    ...current.files
      .filter((file) => file.staged === staged && file.status !== "conflicted")
      .map((file) => file.path),
    ...[...current.folders.values()].flatMap((child) => collectPaths(child, staged)),
  ];
}

function FolderAction({
  path,
  paths,
  staged,
  disabled,
  onApply,
}: {
  path: string;
  paths: string[];
  staged: boolean;
  disabled: boolean;
  onApply: (paths: string[]) => void;
}) {
  if (!paths.length) return null;
  const label = staged ? "取消暂存" : "暂存";
  const exceedsLimit = paths.length > GIT_BATCH_PATH_LIMIT;
  const title = exceedsLimit
    ? `此目录下有 ${paths.length} 个文件，单次最多处理 ${GIT_BATCH_PATH_LIMIT} 个，请选择子目录或文件`
    : `${label}此目录下 ${paths.length} 个文件`;
  const Icon = staged ? Minus : Plus;
  return (
    <button
      type="button"
      disabled={disabled || exceedsLimit}
      aria-label={`${label}目录 ${path}`}
      title={title}
      onClick={() => onApply(paths)}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-surface group-hover/folder-row:opacity-100 group-focus-within/folder-row:opacity-100 focus:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100"
    >
      <Icon size={13} />
    </button>
  );
}

export function GitChangeTree({
  changes,
  disabled,
  onOpen,
  onStage,
  onUnstage,
  onStageFolder,
  onUnstageFolder,
  onDiscard,
}: {
  changes: GitTreeChange[];
  disabled: boolean;
  onOpen: (change: GitTreeChange) => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onStageFolder: (paths: string[]) => void;
  onUnstageFolder: (paths: string[]) => void;
  onDiscard: (change: GitTreeChange) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  function branch(current: Node, depth: number, prefix: string) {
    return (
      <>
        {[...current.folders]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, first]) => {
            let child = first,
              label = name;
            while (!child.files.length && child.folders.size === 1) {
              const next = [...child.folders][0];
              if (!next) break;
              label += `/${next[0]}`;
              child = next[1];
            }
            const key = `${prefix}${name}`;
            const folderPath = `${prefix}${label}`;
            const closed = collapsed.has(key);
            return (
              <div key={name}>
                <div
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className="group/folder-row flex min-h-6 min-w-0 items-center gap-1.5 rounded-md pr-5 text-[11px] text-ink-2 hover:bg-surface-2 focus-within:bg-surface-2"
                >
                  <button
                    type="button"
                    aria-expanded={!closed}
                    title={folderPath}
                    className={rowLabelClass}
                    onClick={() =>
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    <ChevronRight
                      size={11}
                      className={`shrink-0 transition-transform motion-reduce:transition-none ${closed ? "" : "rotate-90"}`}
                    />
                    <Folder size={13} className="shrink-0 text-warning" />
                    <span className="truncate">{label}</span>
                  </button>
                  <FolderAction
                    path={folderPath}
                    paths={collectPaths(child, false)}
                    staged={false}
                    disabled={disabled}
                    onApply={onStageFolder}
                  />
                  <FolderAction
                    path={folderPath}
                    paths={collectPaths(child, true)}
                    staged
                    disabled={disabled}
                    onApply={onUnstageFolder}
                  />
                </div>
                {!closed && branch(child, depth + 1, `${folderPath}/`)}
              </div>
            );
          })}
        {current.files
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((change) => (
            <div
              key={change.path}
              style={{ paddingLeft: 8 + depth * 12 }}
              className="group flex min-w-0 items-center gap-1 rounded-md pr-1 hover:bg-surface-2 focus-within:bg-surface-2"
            >
              <button
                type="button"
                title={change.origPath ? `${change.origPath} → ${change.path}` : change.path}
                aria-label={`查看差异 ${change.path}${change.staged ? "（已暂存）" : ""}`}
                onClick={() => onOpen(change)}
                className={`${rowLabelClass} py-1 text-[11px] text-ink-2`}
              >
                <FileCode2 size={13} className="col-start-2 text-accent" />
                <span className="truncate">{change.path.split("/").at(-1)}</span>
              </button>
              {!change.staged && change.status !== "conflicted" ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`暂存 ${change.path}`}
                  title="暂存更改"
                  onClick={() => onStage(change.path)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100"
                >
                  <Plus size={13} />
                </button>
              ) : null}
              {change.staged ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`取消暂存 ${change.path}`}
                  title="取消暂存（保留工作区修改）"
                  onClick={() => onUnstage(change.path)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-surface group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100"
                >
                  <Minus size={13} />
                </button>
              ) : change.status !== "conflicted" ? (
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`放弃更改 ${change.path}`}
                  title={
                    change.status === "untracked" ? "放弃更改（删除未跟踪文件）" : "放弃未暂存更改"
                  }
                  onClick={() => onDiscard(change)}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 disabled:opacity-30 [@media(hover:none)]:opacity-100"
                >
                  <Undo2 size={13} />
                </button>
              ) : null}
              <span
                title={change.status}
                className={`w-4 shrink-0 text-center font-mono text-[10px] ${change.status === "deleted" || change.status === "conflicted" ? "text-danger" : change.status === "untracked" || change.status === "added" ? "text-success" : "text-warning"}`}
              >
                {letters[change.status] ?? change.status.slice(0, 1).toUpperCase()}
              </span>
            </div>
          ))}
      </>
    );
  }
  return <div>{branch(tree(changes), 0, "")}</div>;
}
