import type { FileScope } from "@larness/shared";
import { ErrorMessage } from "@larness/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useState } from "react";
import { openFile } from "@/features/files/actions";
import { fileError, listDirectory, scopeId } from "@/features/files/api";
import { useFileWatch } from "@/features/files/useFileWatch";
import { USE_MOCKS } from "@/lib/env";
import { queryClient, useSnapshot } from "@/lib/queries";
import { activeWorkspaceScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { DemoFileTreePanel } from "./DemoFileTreePanel";
export function FileTreePanel({ projectId }: { projectId: string | null }) {
  const sessionId = useNavigationStore((state) => state.sessionId);
  const { data } = useSnapshot();
  if (USE_MOCKS) return <DemoFileTreePanel projectId={projectId} />;
  const scope = activeWorkspaceScope(projectId, sessionId, data.sessions);
  return <RealFileTree key={scopeId(scope)} scope={scope} />;
}
function RealFileTree({ scope }: { scope: FileScope }) {
  const [expanded, setExpanded] = useState<string[]>(["."]);
  const [error, setError] = useState<string | null>(null);
  useFileWatch(scope, expanded);
  return (
    <div className="p-1.5 text-[11px] text-ink-2">
      <ErrorMessage message={error} onDismiss={() => setError(null)} />
      <Directory
        scope={scope}
        path="."
        depth={0}
        expanded={expanded}
        toggle={(path) =>
          setExpanded((current) =>
            current.includes(path)
              ? current.filter((item) => item !== path && !item.startsWith(`${path}/`))
              : [...current, path],
          )
        }
        open={(path) => {
          setError(null);
          void openFile(
            scope,
            path,
            "projectId" in scope ? "project" : "workspace" in scope ? "global" : "session",
          ).catch((error: unknown) => setError(fileError(error)));
        }}
      />
    </div>
  );
}
function Directory({
  scope,
  path,
  depth,
  expanded,
  toggle,
  open,
}: {
  scope: FileScope;
  path: string;
  depth: number;
  expanded: string[];
  toggle: (path: string) => void;
  open: (path: string) => void;
}) {
  const query = useInfiniteQuery({
    queryKey: ["files", scopeId(scope), "directory", path],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listDirectory(scope, path, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 0,
  });
  return (
    <>
      {query.isPending ? <p className="p-2 text-ink-3">正在读取目录…</p> : null}
      <ErrorMessage
        message={query.isError ? fileError(query.error) : null}
        retry={{
          label: "重新加载目录",
          run: () =>
            void queryClient.resetQueries({
              queryKey: ["files", scopeId(scope), "directory", path],
            }),
        }}
      />
      {query.data?.pages
        .flatMap((page) => page.items)
        .map((entry) => (
          <div key={entry.path}>
            <button
              type="button"
              aria-label={
                entry.type === "directory" ? `目录 ${entry.name}` : `打开文件 ${entry.name}`
              }
              aria-expanded={entry.type === "directory" ? expanded.includes(entry.path) : undefined}
              className="flex h-[26px] w-full items-center gap-1.5 rounded px-1.5 text-left hover:bg-accent-soft"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => (entry.type === "directory" ? toggle(entry.path) : open(entry.path))}
            >
              {entry.type === "directory" ? (
                <>
                  {expanded.includes(entry.path) ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
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
            {entry.type === "directory" && expanded.includes(entry.path) ? (
              <Directory
                scope={scope}
                path={entry.path}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
                open={open}
              />
            ) : null}
          </div>
        ))}
      {path === "." &&
      query.isSuccess &&
      query.data.pages.every((page) => page.items.length === 0) ? (
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
