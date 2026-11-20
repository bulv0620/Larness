import type { MemoryBudget, MemoryChangedPayload, MemoryDto } from "@larness/shared";
import { apiFetch } from "@/lib/api";

export interface MemoryListResponse {
  items: MemoryDto[];
  total: number;
  budget: MemoryBudget;
}

export interface MemoryListParams {
  status?: string;
  kind?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface CreateMemoryInput {
  kind: string;
  key: string;
  title: string;
  body: string;
  expiresAt?: number | null;
}

export interface UpdateMemoryInput {
  title?: string;
  body?: string;
  expiresAt?: number | null;
  pinned?: boolean;
  status?: "active" | "rejected";
  expectedUpdatedAt: number;
}

export const memoryKeys = {
  all: ["memory"] as const,
  project: (projectId: string) => ["memory", "project", projectId] as const,
  projectList: (projectId: string, params: MemoryListParams = {}) =>
    ["memory", "project", projectId, params] as const,
  global: ["memory", "global"] as const,
  globalList: (params: MemoryListParams = {}) => ["memory", "global", params] as const,
};

function queryString(params: MemoryListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text.length === 0 ? "" : `?${text}`;
}

export async function listProjectMemories(
  projectId: string,
  params: MemoryListParams = {},
): Promise<MemoryListResponse> {
  return apiFetch<MemoryListResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/memories${queryString(params)}`,
  );
}

export async function getProjectBudget(projectId: string): Promise<MemoryBudget> {
  return apiFetch<MemoryBudget>(`/api/projects/${encodeURIComponent(projectId)}/memories/budget`);
}

export async function createProjectMemory(
  projectId: string,
  input: CreateMemoryInput,
): Promise<MemoryDto> {
  return apiFetch<MemoryDto>(`/api/projects/${encodeURIComponent(projectId)}/memories`, {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export async function updateProjectMemory(
  projectId: string,
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<MemoryDto> {
  return apiFetch<MemoryDto>(
    `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`,
    { method: "PATCH", body: input, csrf: true },
  );
}

export async function forgetProjectMemory(
  projectId: string,
  memoryId: string,
  expectedUpdatedAt: number,
): Promise<void> {
  await apiFetch(
    `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}?expectedUpdatedAt=${expectedUpdatedAt}`,
    { method: "DELETE", csrf: true },
  );
}

export async function restoreProjectMemory(
  projectId: string,
  memoryId: string,
): Promise<MemoryDto> {
  return apiFetch<MemoryDto>(
    `/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}/restore`,
    { method: "POST", csrf: true },
  );
}

export async function listGlobalMemories(
  params: MemoryListParams = {},
): Promise<MemoryListResponse> {
  return apiFetch<MemoryListResponse>(`/api/memories/global${queryString(params)}`);
}

export async function getGlobalBudget(): Promise<MemoryBudget> {
  return apiFetch<MemoryBudget>("/api/memories/global/budget");
}

export async function createGlobalMemory(input: CreateMemoryInput): Promise<MemoryDto> {
  return apiFetch<MemoryDto>("/api/memories/global", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export async function updateGlobalMemory(
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<MemoryDto> {
  return apiFetch<MemoryDto>(`/api/memories/global/${encodeURIComponent(memoryId)}`, {
    method: "PATCH",
    body: input,
    csrf: true,
  });
}

export async function forgetGlobalMemory(
  memoryId: string,
  expectedUpdatedAt: number,
): Promise<void> {
  await apiFetch(
    `/api/memories/global/${encodeURIComponent(memoryId)}?expectedUpdatedAt=${expectedUpdatedAt}`,
    {
      method: "DELETE",
      csrf: true,
    },
  );
}

export async function restoreGlobalMemory(memoryId: string): Promise<MemoryDto> {
  return apiFetch<MemoryDto>(`/api/memories/global/${encodeURIComponent(memoryId)}/restore`, {
    method: "POST",
    csrf: true,
  });
}

export type { MemoryChangedPayload };
