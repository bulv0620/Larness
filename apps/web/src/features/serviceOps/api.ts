import {
  type ServiceActionAuthorizationDto,
  ServiceActionAuthorizationDtoSchema,
  type ServiceOpsDeploymentDto,
  type ServiceOpsServiceDto,
  ServiceOpsServiceDtoSchema,
} from "@larness/shared";
import { apiFetch } from "@/lib/api";

export const serviceOpsServicesKey = ["service-ops", "services"] as const;
export const serviceOpsServiceKey = (id: string) => ["service-ops", "service", id] as const;
export const serviceOpsDeploymentsKey = (id: string) => ["service-ops", "deployments", id] as const;
export const serviceOpsLogsKey = (id: string) => ["service-ops", "logs", id] as const;

export async function listFormalServices(): Promise<ServiceOpsServiceDto[]> {
  return (await apiFetch<{ items: ServiceOpsServiceDto[] }>("/api/service-ops/services")).items;
}

export async function readFormalService(id: string): Promise<ServiceOpsServiceDto> {
  return ServiceOpsServiceDtoSchema.parse(
    await apiFetch(`/api/service-ops/services/${encodeURIComponent(id)}`),
  );
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

export async function authorizeServiceAction(input: {
  targetId: string;
  action: "start" | "stop" | "restart" | "recover";
  requestKey: string;
  sessionId?: string;
}): Promise<ServiceActionAuthorizationDto> {
  return ServiceActionAuthorizationDtoSchema.parse(
    await apiFetch(`/api/service-ops/services/${encodeURIComponent(input.targetId)}/actions`, {
      method: "POST",
      csrf: true,
      body: {
        action: input.action,
        requestKey: input.requestKey,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      },
    }),
  );
}

export async function decideServiceAction(
  id: string,
  decision: "approve" | "reject",
): Promise<ServiceActionAuthorizationDto> {
  return ServiceActionAuthorizationDtoSchema.parse(
    await apiFetch(`/api/service-ops/service-actions/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      csrf: true,
      body: { decision },
    }),
  );
}

export async function executeServiceAction(
  id: string,
  consumeKey: string,
): Promise<ServiceOpsServiceDto> {
  return ServiceOpsServiceDtoSchema.parse(
    await apiFetch(`/api/service-ops/service-actions/${encodeURIComponent(id)}/execute`, {
      method: "POST",
      csrf: true,
      body: { consumeKey },
    }),
  );
}
