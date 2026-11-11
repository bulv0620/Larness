import type { HostMetrics } from "@larness/shared";
import { apiFetch } from "./api";

export async function fetchHostMetrics(): Promise<HostMetrics> {
  return apiFetch<HostMetrics>("/api/system/metrics");
}
