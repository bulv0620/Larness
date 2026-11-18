import { type ProcessDto, ProcessDtoSchema } from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const processesKey = (projectId?: string | null) =>
  ["processes", projectId ?? "all"] as const;
export const processKey = (id: string) => ["processes", "detail", id] as const;
export const processOutputKey = (id: string, after: number) =>
  ["processes", "output", id, after] as const;

export async function listProcesses(projectId?: string | null): Promise<ProcessDto[]> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  const result = await apiFetch<{ items: unknown[] }>(`/api/processes${query}`);
  return result.items.map((item) => ProcessDtoSchema.parse(item));
}

export async function readProcess(id: string): Promise<ProcessDto> {
  return ProcessDtoSchema.parse(await apiFetch(`/api/processes/${encodeURIComponent(id)}`));
}

export async function readProcessOutput(id: string, after = 0, limit = 200) {
  return apiFetch<{
    chunks: { cursor: number; data: string; channel: "stdout" | "stderr"; timestamp: number }[];
    nextCursor: number;
    oldestCursor: number;
    truncated: boolean;
    resyncRequired: boolean;
  }>(`/api/processes/${encodeURIComponent(id)}/output?after=${after}&limit=${limit}`);
}

export async function stopProcess(id: string) {
  return apiFetch(`/api/processes/${encodeURIComponent(id)}/stop`, {
    method: "POST",
    csrf: true,
    body: {},
  });
}
