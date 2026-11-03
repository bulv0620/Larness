import type { FileScope } from "@larness/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { queryClient, useSnapshot } from "@/lib/queries";
import { createTerminal, listTerminals, openTerminal, terminalTitle } from "./api";

export function TerminalPicker({
  projectId,
  sessionId,
}: {
  projectId?: string | null;
  sessionId?: string;
}) {
  const { data: snapshot } = useSnapshot();
  const query = useInfiniteQuery({
    queryKey: ["terminals", "list"],
    queryFn: ({ pageParam }) => listTerminals(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 3000,
  });
  const [confirmation, setConfirmation] = useState<{ key: string; scope?: FileScope } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (item) =>
          projectId === undefined ||
          (projectId
            ? item.projectId === projectId
            : sessionId
              ? item.workspaceSessionId === sessionId
              : !item.projectId && !item.workspaceSessionId),
      ) ?? [];
  return (
    <div className="h-full space-y-2 overflow-auto p-3 text-xs text-ink">
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy || confirmation !== null}
          onClick={() =>
            setConfirmation({
              key: crypto.randomUUID(),
              scope: projectId ? { projectId } : sessionId ? { sessionId } : undefined,
            })
          }
        >
          新建终端
        </button>
        <button type="button" onClick={() => void query.refetch()}>
          刷新列表
        </button>
      </div>
      {query.isError ? <p role="alert">终端列表读取失败，请重试。</p> : null}
      {!items.length ? <p className="text-ink-3">暂无终端；打开窗口不会创建进程。</p> : null}
      {items.map((item) => (
        <button
          className="block w-full rounded border border-line p-2 text-left hover:bg-surface-2"
          type="button"
          key={item.id}
          aria-label={`打开终端 ${item.id}`}
          onClick={() => openTerminal(item)}
        >
          <span>
            {snapshot.projects.find((p) => p.id === item.projectId)?.name ??
              (item.workspaceSessionId ? "独立会话" : "全局")}{" "}
            · {terminalTitle(item)}
          </span>
          <span className="ml-2 text-ink-3">{item.status}</span>
          <span className="block truncate text-ink-3">{item.cwd}</span>
        </button>
      ))}
      {query.hasNextPage ? (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          加载更多终端
        </button>
      ) : null}
      {confirmation ? (
        <div
          role="dialog"
          aria-label="创建终端确认"
          className="space-y-3 rounded border border-line bg-surface p-3"
        >
          <p>
            以 Larness 系统账户执行，项目目录不是沙箱。Shell
            可访问主机文件和凭据，也可能并发修改源码。
          </p>
          <p>{confirmation.scope ? "在当前项目或独立会话工作区创建" : "在全局专用工作区创建"}</p>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const item = await createTerminal(confirmation.scope, confirmation.key);
                openTerminal(item);
                setConfirmation(null);
                void queryClient.invalidateQueries({ queryKey: ["terminals"] });
              } catch {
                setError("创建结果未确认，请重试核对；重试不会重复创建。");
              } finally {
                setBusy(false);
              }
            }}
          >
            确认创建
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmation(null)}>
            取消
          </button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
