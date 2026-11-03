import type {
  GitAction,
  GitActionView,
  GitBranchView,
  GitDiffView,
  GitLogView,
  GitStatusView,
} from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const gitKey = (projectId: string) => ["git", projectId] as const;

export async function readGitStatus(projectId: string): Promise<GitStatusView> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/git/status`);
}
export async function readGitDiff(
  projectId: string,
  path: string,
  staged: boolean,
): Promise<GitDiffView> {
  return apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`,
  );
}
export async function readGitLog(projectId: string, limit = 50, cursor = 0): Promise<GitLogView[]> {
  const result = await apiFetch<{ items: GitLogView[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/log?limit=${limit}&cursor=${cursor}`,
  );
  return result.items;
}
export async function readGitBranches(
  projectId: string,
  limit = 100,
  cursor = 0,
): Promise<GitBranchView[]> {
  const result = await apiFetch<{ items: GitBranchView[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/git/branches?limit=${limit}&cursor=${cursor}`,
  );
  return result.items;
}
export async function createGitAction(
  projectId: string,
  action: GitAction,
): Promise<GitActionView> {
  return apiFetch(`/api/projects/${encodeURIComponent(projectId)}/git/actions`, {
    method: "POST",
    csrf: true,
    body: action,
  });
}
export async function decideGitAction(
  id: string,
  decision: "approve" | "reject",
): Promise<GitActionView> {
  return apiFetch(`/api/resource-actions/${encodeURIComponent(id)}/decision`, {
    method: "POST",
    csrf: true,
    body: { decision },
  });
}
export async function executeGitAction(id: string): Promise<GitActionView> {
  return apiFetch(`/api/resource-actions/${encodeURIComponent(id)}/execute`, {
    method: "POST",
    csrf: true,
    body: {},
  });
}
export async function readGitAction(id: string): Promise<GitActionView> {
  return apiFetch(`/api/resource-actions/${encodeURIComponent(id)}`);
}
