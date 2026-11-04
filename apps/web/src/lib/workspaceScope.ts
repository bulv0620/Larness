import type { FileScope, SessionSummary } from "@larness/shared";

export function activeWorkspaceScope(
  projectId: string | null,
  sessionId: string,
  sessions: SessionSummary[],
): FileScope {
  if (projectId) return { projectId };
  const session = sessions.find((item) => item.id === sessionId);
  return session && session.workspaceKind !== "default"
    ? { sessionId: session.id }
    : { workspace: "default" };
}
export function activeWindowScope(
  projectId: string | null,
  sessionId: string,
  sessions: SessionSummary[],
): string {
  const scope = activeWorkspaceScope(projectId, sessionId, sessions);
  return "projectId" in scope
    ? `project:${scope.projectId}`
    : "sessionId" in scope
      ? `session:${scope.sessionId}`
      : "global";
}

export function unassignedWorkspaceLabel(sessionId: string, sessions: SessionSummary[]): string {
  return "workspace" in activeWorkspaceScope(null, sessionId, sessions) ? "默认工作区" : "独立会话";
}
