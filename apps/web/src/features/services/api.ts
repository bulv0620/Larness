import {
  type ServiceActionView,
  ServiceActionViewSchema,
  ServiceDtoSchema,
  ServiceListSchema,
  type ServiceRegisterInput,
} from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const servicesKey = (projectId: string) => ["services", projectId] as const;
export const serviceKey = (id: string) => ["services", "detail", id] as const;
export const serviceLogsKey = (id: string, after: number) =>
  ["services", "logs", id, after] as const;

export async function listServices(projectId: string) {
  const result = ServiceListSchema.parse(
    await apiFetch(`/api/services?projectId=${encodeURIComponent(projectId)}&limit=200`),
  );
  return result.items;
}

export async function readService(id: string) {
  return ServiceDtoSchema.parse(await apiFetch(`/api/services/${encodeURIComponent(id)}`));
}

export async function readServiceLogs(id: string, after = 0, limit = 200) {
  return apiFetch<{
    terminalId: string;
    chunks: { cursor: number; data: string; timestamp: number }[];
    nextCursor: number;
    truncated: boolean;
    resyncRequired: boolean;
  }>(`/api/services/${encodeURIComponent(id)}/logs?after=${after}&limit=${limit}`);
}

export async function createServiceAction(input: ServiceRegisterInput) {
  return ServiceActionViewSchema.parse(
    await apiFetch("/api/services", { method: "POST", csrf: true, body: input }),
  ) as ServiceActionView;
}

export async function decideServiceAction(id: string, decision: "approve" | "reject") {
  return ServiceActionViewSchema.parse(
    await apiFetch(`/api/resource-actions/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      csrf: true,
      body: { decision },
    }),
  ) as ServiceActionView;
}

export async function executeServiceAction(id: string) {
  return ServiceActionViewSchema.parse(
    await apiFetch(`/api/resource-actions/${encodeURIComponent(id)}/execute`, {
      method: "POST",
      csrf: true,
      body: {},
    }),
  ) as ServiceActionView;
}

export interface PreviewSession {
  origin: string;
  bootstrapUrl: string;
  ticket: string;
  expiresAt: number;
}

export async function resolvePreview(serviceId: string, path = "/"): Promise<PreviewSession> {
  return apiFetch<PreviewSession>("/api/previews/resolve", {
    method: "POST",
    csrf: true,
    body: { serviceId, path },
  });
}

export async function stopService(id: string) {
  return ServiceDtoSchema.parse(
    await apiFetch(`/api/services/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      csrf: true,
      body: {},
    }),
  );
}

export async function deleteService(id: string) {
  return ServiceDtoSchema.parse(
    await apiFetch(`/api/services/${encodeURIComponent(id)}`, {
      method: "DELETE",
      csrf: true,
    }),
  );
}
