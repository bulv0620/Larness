import { DEFAULT_PROJECT_ID, type FileScope, type LiveTerminal } from "@larness/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { SquareTerminal } from "lucide-react";
import { useEffect } from "react";
import { listTerminals, terminalTitle } from "./api";
import { CreateTerminalButton } from "./CreateTerminalButton";
import { TerminalOpenButton } from "./TerminalOpenButton";

export function TerminalPicker({
  projectId,
  sessionId,
}: {
  projectId?: string | null;
  sessionId?: string;
}) {
  const scope: FileScope = projectId
    ? { projectId }
    : sessionId
      ? { sessionId }
      : { workspace: "default" };
  const query = useInfiniteQuery({
    queryKey: ["terminals", "list", projectId, sessionId],
    queryFn: ({ pageParam }) => listTerminals(pageParam, scope),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page, _pages, cursor) =>
      page.nextCursor && page.nextCursor !== cursor ? page.nextCursor : undefined,
    refetchInterval: 3000,
  });
  const inScope = (item: LiveTerminal) =>
    projectId && projectId !== DEFAULT_PROJECT_ID
      ? item.projectId === projectId
      : sessionId
        ? item.workspaceSessionId === sessionId
        : !item.projectId && !item.workspaceSessionId;
  const items =
    query.data?.pages
      .flatMap((page) => page.items)
      .filter((item) => item.status === "RUNNING" && inScope(item)) ?? [];
  const lastPageHasRunning =
    query.data?.pages.at(-1)?.items.some((item) => item.status === "RUNNING" && inScope(item)) ??
    false;
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError && !lastPageHasRunning) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, lastPageHasRunning, fetchNextPage]);
  const searching =
    query.isPending || query.isFetchingNextPage || (hasNextPage && !lastPageHasRunning && !isError);
  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-[12px] text-ink">
      {isError ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-ink-3">
            终端列表读取失败，请重试。
          </p>
          <button
            type="button"
            className="text-accent"
            onClick={() => {
              if (query.isFetchNextPageError) void fetchNextPage();
              else void query.refetch();
            }}
          >
            重试
          </button>
          {!items.length ? (
            <CreateTerminalButton scope={scope} className="ml-auto text-accent" />
          ) : null}
        </div>
      ) : null}
      {items.length ? (
        <>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-3">运行中的终端</span>
            <CreateTerminalButton scope={scope} className="text-accent" />
          </div>
          <div className="space-y-1">
            {items.map((item) => (
              <TerminalOpenButton
                key={item.id}
                terminalId={item.id}
                projectId={item.projectId}
                ariaLabel={`打开终端 ${item.id}`}
                label={terminalTitle(item)}
                className="w-full rounded-lg px-2 py-2 hover:bg-surface-2"
              />
            ))}
          </div>
        </>
      ) : !searching && !isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <SquareTerminal size={24} aria-hidden="true" className="text-ink-3/50" />
          <p className="text-ink-3">暂无运行中的终端</p>
          <CreateTerminalButton
            scope={scope}
            className="rounded-lg bg-accent px-3 py-1.5 text-white"
          />
        </div>
      ) : null}
      {searching ? (
        <p role="status" className="py-3 text-center text-[11px] text-ink-3">
          正在读取终端…
        </p>
      ) : null}
      {hasNextPage && !searching && !isError ? (
        <button
          type="button"
          className="mt-2 self-start text-[11px] text-accent"
          onClick={() => void fetchNextPage()}
        >
          加载更多运行终端
        </button>
      ) : null}
    </div>
  );
}
