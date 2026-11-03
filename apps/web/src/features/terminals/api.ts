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
export const terminalTitle = (item: LiveTerminal) => item.role ?? `Shell ${item.id.slice(-6)}`;
export async function readTerminal(id: string) {
  return TerminalSchema.parse(await apiFetch(`/api/terminals/${encodeURIComponent(id)}`));
}
export async function listTerminals(cursor?: string) {
  return TerminalListSchema.parse(
    await apiFetch(
      `/api/terminals?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
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
  action: "lease" | "resize" | "terminate" | "takeover",
  body: unknown,
) {
  const result = TerminalSchema.parse(
    await apiFetch(`/api/terminals/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
      csrf: true,
      body,
    }),
  );
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
    sessionId: item.sourceSessionId,
    source:
      item.mode === "dev"
        ? "agent"
        : item.projectId
          ? "project"
          : item.workspaceSessionId
            ? "session"
            : "global",
  });
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
