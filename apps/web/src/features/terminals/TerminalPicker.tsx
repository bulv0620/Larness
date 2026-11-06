import { DEFAULT_PROJECT_ID, type FileScope, type LiveTerminal } from "@larness/shared";
import { useQuery } from "@tanstack/react-query";
import { SquareTerminal } from "lucide-react";
import { useEffect } from "react";
import { ApiError } from "@/lib/api";
import { listTerminals, openTerminal, readTerminal } from "./api";
import { CreateTerminalButton } from "./CreateTerminalButton";

function isInScope(item: LiveTerminal, scope: FileScope): boolean {
  if ("projectId" in scope && scope.projectId !== DEFAULT_PROJECT_ID)
    return item.projectId === scope.projectId;
  if ("sessionId" in scope) return item.workspaceSessionId === scope.sessionId;
  return !item.projectId && !item.workspaceSessionId;
}

async function readLatestRunning(scope: FileScope, signal: AbortSignal) {
  const candidates: LiveTerminal[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal.throwIfAborted();
    const page = await listTerminals(cursor, scope);
    candidates.push(
      ...page.items.filter((item) => item.status === "RUNNING" && isInScope(item, scope)),
    );
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("Repeated terminal cursor");
      seenCursors.add(cursor);
    }
  } while (cursor);

  for (const candidate of candidates.reverse()) {
    signal.throwIfAborted();
    const current = await readTerminal(candidate.id).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
    if (!current) continue;
    if (current.id !== candidate.id || !isInScope(current, scope))
      throw new Error("Terminal scope changed");
    if (current.status === "RUNNING") return current;
  }
  return null;
}

export function TerminalPicker({
  projectId,
  sessionId,
  visible = true,
}: {
  projectId?: string | null;
  sessionId?: string;
  visible?: boolean;
}) {
  const scope: FileScope = projectId
    ? { projectId }
    : sessionId
      ? { sessionId }
      : { workspace: "default" };
  const { data, isFetchedAfterMount, isError, isFetching, refetch } = useQuery({
    queryKey: ["terminals", "restore", projectId, sessionId],
    queryFn: ({ signal }) => readLatestRunning(scope, signal),
    enabled: visible,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (visible && data && isFetchedAfterMount && !isError && !isFetching) openTerminal(data);
  }, [data, isFetchedAfterMount, isError, isFetching, visible]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-3 text-[12px] text-ink">
      {isError && !isFetching ? (
        <>
          <p role="alert" className="text-ink-3">
            无法恢复终端，请重试。
          </p>
          <button type="button" className="text-accent" onClick={() => void refetch()}>
            重试
          </button>
          <CreateTerminalButton scope={scope} className="text-accent" />
        </>
      ) : !isFetchedAfterMount || isFetching || data ? (
        <p role="status" className="text-ink-3">
          正在读取终端…
        </p>
      ) : (
        <>
          <SquareTerminal size={24} aria-hidden="true" className="text-ink-3/50" />
          <p className="text-ink-3">暂无运行中的终端</p>
          <CreateTerminalButton
            scope={scope}
            className="rounded-lg bg-accent px-3 py-1.5 text-white"
          />
        </>
      )}
    </div>
  );
}
