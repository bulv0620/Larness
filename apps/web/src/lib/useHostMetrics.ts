import type { HostMetrics } from "@larness/shared";
import { useQuery } from "@tanstack/react-query";
import { USE_MOCKS } from "./env";
import { fetchHostMetrics } from "./systemApi";

const REFRESH_INTERVAL_MS = 4_000;

/**
 * Polls the Server for the machine that runs it. Returns null until the first
 * sample, so the Header never presents placeholder zeros as real usage.
 */
export function useHostMetrics(fallback: HostMetrics): HostMetrics | null {
  const query = useQuery({
    queryKey: ["host-metrics"],
    queryFn: fetchHostMetrics,
    enabled: !USE_MOCKS,
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: 0,
    retry: false,
  });

  if (USE_MOCKS) return fallback;

  return query.data ?? null;
}
