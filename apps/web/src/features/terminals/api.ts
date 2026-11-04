import {
  type FileScope,
  type LiveTerminal,
  TerminalListSchema,
  type TerminalResultTarget,
  TerminalResultTargetSchema,
  TerminalSchema,
} from "@larness/shared";

export { OutputSchema } from "@larness/shared";

import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";

export const terminalKey = (id: string) => ["terminals", "detail", id] as const;
export const ended = (status: string) => ["EXITED", "TERMINATED", "INTERRUPTED"].includes(status);
export const terminalTitle = (item: LiveTerminal) =>
  item.title ?? item.role ?? `Shell ${item.id.slice(-6)}`;
export async function readTerminal(id: string) {
  return TerminalSchema.parse(await apiFetch(`/api/terminals/${encodeURIComponent(id)}`));
}
export async function listTerminals(cursor?: string, scope?: FileScope) {
  return TerminalListSchema.parse(
    await apiFetch(
      `/api/terminals?limit=50${scope && "projectId" in scope ? `&projectId=${encodeURIComponent(scope.projectId)}` : scope && "sessionId" in scope ? `&workspaceSessionId=${encodeURIComponent(scope.sessionId)}` : "&global=true"}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  );
}
export async function createTerminal(scope: FileScope | undefined, key: string) {
  return TerminalSchema.parse(
    await apiFetch("/api/terminals", {
      method: "POST",
      csrf: true,
      headers: { "Idempotency-Key": key },
      body: { scope, riskAcknowledged: true },
    }),
  );
}
export async function terminalAction(
  id: string,
  action: "lease" | "resize" | "terminate" | "takeover" | "rename",
  body: unknown,
) {
  const result = TerminalSchema.parse(
    await apiFetch(`/api/terminals/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      csrf: true,
      body,
    }),
  );
  queryClient.setQueryData(terminalKey(id), result);
  if (action === "rename") {
    useWindowStore.setState((state) => ({
      windows: state.windows.map((win) => ({
        ...win,
        tabs: win.tabs.map((tab) =>
          tab.resourceId === id ? { ...tab, title: terminalTitle(result) } : tab,
        ),
      })),
    }));
  }
  await queryClient.invalidateQueries({ queryKey: ["terminals"] });
  return result;
}
export function openTerminal(item: LiveTerminal) {
  queryClient.setQueryData(terminalKey(item.id), item);
  useWindowStore.getState().open({
    kind: "terminal",
    resourceId: item.id,
    title: terminalTitle(item),
    projectId: item.projectId,
    sessionId: item.projectId ? item.sourceSessionId : item.workspaceSessionId,
    source:
      item.mode === "dev"
        ? "agent"
        : item.projectId
          ? "project"
          : item.workspaceSessionId
            ? "session"
            : "global",
  });
  for (const win of useWindowStore.getState().windows) {
    if (!win.tabs.some((tab) => tab.resourceId === item.id)) continue;
    for (const tab of win.tabs)
      if (tab.resourceId === "terminal:empty") useWindowStore.getState().closeTab(win.id, tab.id);
  }
}

export function applyAgentTerminalEvent(
  payload: Record<string, unknown>,
  clientSessionId: string | undefined,
): boolean {
  const target = TerminalResultTargetSchema.safeParse(payload.resourceTarget);
  if (
    !target.success ||
    typeof payload.originClientSessionId !== "string" ||
    payload.originClientSessionId !== clientSessionId
  )
    return false;
  openAgentTerminal(target.data);
  return true;
}

export function openAgentTerminal(target: TerminalResultTarget, activate = false) {
  void queryClient.invalidateQueries({ queryKey: ["terminals"] });
  useWindowStore.getState().open({
    kind: "terminal",
    resourceId: target.terminalId,
    title: target.role ?? "终端",
    projectId: target.projectId,
    source: "agent",
    activate,
  });
}

export function stopConfirmed(item: Pick<LiveTerminal, "status" | "reasonCode">) {
  return (
    item.status === "EXITED" ||
    item.status === "TERMINATED" ||
    (item.status === "INTERRUPTED" && item.reasonCode === "NOT_STARTED")
  );
}

export async function applyAgentTerminalClosedEvent(
  payload: Record<string, unknown>,
  clientSessionId: string | undefined,
): Promise<boolean> {
  const target = TerminalResultTargetSchema.safeParse(payload.closedTerminalTarget);
  if (!target.success || !clientSessionId || payload.originClientSessionId !== clientSessionId)
    return false;
  const { terminalId, projectId } = target.data;
  const matches = () =>
    useWindowStore
      .getState()
      .windows.flatMap((win) =>
        win.tabs
          .filter(
            (tab) =>
              tab.kind === "terminal" &&
              tab.resourceId === terminalId &&
              tab.projectId === projectId,
          )
          .map((tab) => ({ windowId: win.id, tabId: tab.id })),
      );
  if (!matches().length) return false;
  try {
    const row = await readTerminal(terminalId);
    if (row.id !== terminalId || row.projectId !== projectId || !stopConfirmed(row)) return false;
    queryClient.setQueryData(terminalKey(terminalId), row);
    const focusedId = useWindowStore.getState().focusedId;
    for (const tab of matches()) useWindowStore.getState().closeTab(tab.windowId, tab.tabId);
    // Closing the last tab in a background window must preserve the foreground window.
    if (focusedId && useWindowStore.getState().windows.some((win) => win.id === focusedId))
      useWindowStore.setState({ focusedId });
    void queryClient.invalidateQueries({ queryKey: ["terminals"] });
    return true;
  } catch {
    // A notification is not proof of current resource state. Keep the view on read failure.
    return false;
  }
}
