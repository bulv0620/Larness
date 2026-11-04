import { ChevronRight, FileCode2, Folder, Plus } from "lucide-react";
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
export function GitChangeTree({
  changes,
  disabled,
  onOpen,
  onStage,
}: {
  changes: GitTreeChange[];
  disabled: boolean;
  onOpen: (change: GitTreeChange) => void;
  onStage: (path: string) => void;
}) {
  function branch(current: Node, depth: number) {
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
            return (
              <details key={name} open className="group/folder">
                <summary
                  style={{ paddingLeft: 8 + depth * 12 }}
                  className="flex cursor-pointer list-none items-center gap-1.5 py-1 text-[11px] text-ink-2 hover:bg-surface-2"
                >
                  <ChevronRight
                    size={11}
                    className="shrink-0 transition-transform group-open/folder:rotate-90 motion-reduce:transition-none"
                  />
                  <Folder size={13} className="shrink-0 text-warning" />
                  <span className="truncate">{label}</span>
                </summary>
                {branch(child, depth + 1)}
              </details>
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
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-[11px] text-ink-2"
              >
                <FileCode2 size={13} className="shrink-0 text-accent" />
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
  return <div>{branch(tree(changes), 0)}</div>;
}
