import { apiFetch } from "@/lib/api";

export interface PreviewSession {
  origin: string;
  bootstrapUrl: string;
  ticket: string;
  expiresAt: number;
  mode: "embedded" | "external";
}

export async function resolvePreview(
  targetId: string,
  path = "/",
  mode: "embedded" | "external" = "embedded",
  targetKind: "service" | "process" = "service",
  projectId?: string,
): Promise<PreviewSession> {
  return apiFetch<PreviewSession>("/api/previews/resolve", {
    method: "POST",
    csrf: true,
    body:
      targetKind === "process"
        ? { processId: targetId, projectId, path, mode }
        : { serviceId: targetId, path, mode },
  });
}
