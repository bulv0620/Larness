import type { HostMetrics } from "@harness/shared";
import { useEffect, useState } from "react";

export function useLiveHost(initial: HostMetrics): HostMetrics {
  const [metrics, setMetrics] = useState(initial);

  useEffect(() => {
    setMetrics(initial);
  }, [initial]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMetrics((current) => ({
        cpuPercent: Math.max(18, Math.min(72, current.cpuPercent + (Math.random() - 0.5) * 4)),
        memoryUsedGb: Math.max(
          6,
          Math.min(current.memoryTotalGb - 1, current.memoryUsedGb + (Math.random() - 0.5) * 0.12),
        ),
        memoryTotalGb: current.memoryTotalGb,
      }));
    }, 3600);
    return () => window.clearInterval(timer);
  }, []);

  return metrics;
}
