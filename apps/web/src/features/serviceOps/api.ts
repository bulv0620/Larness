import {
  type ServiceControlInput,
  type ServiceOpsDeploymentDto,
  type ServiceOpsServiceDto,
  ServiceOpsServiceDtoSchema,
  ServiceOpsServiceListSchema,
} from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const serviceOpsServicesKey = ["service-ops", "services"] as const;
export const serviceOpsDeploymentsKey = (id: string) => ["service-ops", "deployments", id] as const;
export const serviceOpsLogsKey = (id: string) => ["service-ops", "logs", id] as const;

export async function controlFormalService(
  id: string,
  input: ServiceControlInput,
): Promise<ServiceOpsServiceDto> {
  return ServiceOpsServiceDtoSchema.parse(
    await apiFetch(`/api/service-ops/services/${encodeURIComponent(id)}/control`, {
      method: "POST",
      csrf: true,
      body: input,
    }),
  );
}

export async function listFormalServices(): Promise<{
  items: ServiceOpsServiceDto[];
  unassociated: { pm2Name: string; reason: string }[];
  pm2Home?: string;
}> {
  return ServiceOpsServiceListSchema.parse(await apiFetch("/api/service-ops/services"));
}
export async function listFormalDeployments(id: string): Promise<ServiceOpsDeploymentDto[]> {
  return (
    await apiFetch<{ items: ServiceOpsDeploymentDto[] }>(
      `/api/service-ops/services/${encodeURIComponent(id)}/deployments`,
    )
  ).items;
}
export async function readFormalLogs(
  id: string,
): Promise<{ text: string; cursor: number; truncated: boolean }> {
  return apiFetch(`/api/service-ops/services/${encodeURIComponent(id)}/logs`);
}
