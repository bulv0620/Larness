import type {
  JobListDto,
  JobRunListDto,
  JobsSummaryDto,
  ScheduledJobDto,
  ScheduledJobInput,
  ScheduledJobPatch,
  ScheduledJobRunDto,
} from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const jobsKey = ["jobs"] as const;
export const jobsSummaryKey = ["jobs", "summary"] as const;
export const jobKey = (id: string) => ["jobs", "detail", id] as const;
export const jobRunsKey = (id: string) => ["jobs", "runs", id] as const;

export async function listJobs(): Promise<JobListDto> {
  return apiFetch<JobListDto>("/api/jobs");
}

export async function getJobsSummary(): Promise<JobsSummaryDto> {
  return apiFetch<JobsSummaryDto>("/api/jobs/summary");
}

export async function getJob(id: string): Promise<ScheduledJobDto> {
  return apiFetch<ScheduledJobDto>(`/api/jobs/${encodeURIComponent(id)}`);
}

export async function createJob(input: ScheduledJobInput): Promise<ScheduledJobDto> {
  return apiFetch<ScheduledJobDto>("/api/jobs", { method: "POST", csrf: true, body: input });
}

export async function updateJob(id: string, patch: ScheduledJobPatch): Promise<ScheduledJobDto> {
  return apiFetch<ScheduledJobDto>(`/api/jobs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    csrf: true,
    body: patch,
  });
}

export async function deleteJob(id: string): Promise<void> {
  await apiFetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE", csrf: true });
}

export async function runJobNow(id: string): Promise<ScheduledJobRunDto> {
  return apiFetch<ScheduledJobRunDto>(`/api/jobs/${encodeURIComponent(id)}/run`, {
    method: "POST",
    csrf: true,
  });
}

export async function listJobRuns(id: string, cursor?: string): Promise<JobRunListDto> {
  const query = new URLSearchParams({ limit: "50" });
  if (cursor) query.set("cursor", cursor);
  return apiFetch<JobRunListDto>(`/api/jobs/${encodeURIComponent(id)}/runs?${query.toString()}`);
}

export async function cancelJobRun(id: string): Promise<ScheduledJobRunDto> {
  return apiFetch<ScheduledJobRunDto>(`/api/job-runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    csrf: true,
  });
}
