import type { HostMetrics } from "@larness/shared";
import { Cpu, type LucideIcon, MemoryStick } from "lucide-react";
import type { ReactNode } from "react";
import { formatBytesPairParts, usedPercent } from "@/lib/format";

const HIGH_USAGE_PERCENT = 90;

interface HostMetricProps {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  valueClass: string;
}

function HostMetric({ icon: Icon, label, value, valueClass }: HostMetricProps) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon size={13} strokeWidth={1.9} className="shrink-0 text-ink-3" />
      <span className="text-[9px] font-medium uppercase tracking-[.08em] text-ink-3">{label}</span>
      <span className={`font-mono text-[10px] font-medium tabular-nums ${valueClass}`}>
        {value}
      </span>
    </span>
  );
}

export function HostMetricsIndicator({ metrics }: { metrics: HostMetrics | null }) {
  const cpuPercent = metrics === null ? null : Math.min(100, Math.max(0, metrics.cpuPercent));
  const cpuValue = cpuPercent === null ? "—" : `${Math.round(cpuPercent)}%`;
  const cpuAlert = cpuPercent !== null && cpuPercent > HIGH_USAGE_PERCENT;

  const memoryParts = formatBytesPairParts(
    metrics?.memoryUsedBytes ?? 0,
    metrics?.memoryTotalBytes ?? 0,
  );
  const memoryPercent = usedPercent(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0);
  const memoryAlert = memoryParts !== null && memoryPercent > HIGH_USAGE_PERCENT;

  return (
    <div className="mr-1 hidden items-center gap-3 xl:flex">
      <span className="sr-only">服务端资源占用</span>
      <HostMetric
        icon={Cpu}
        label="CPU"
        value={cpuValue}
        valueClass={cpuAlert ? "text-danger" : "text-ink"}
      />
      <HostMetric
        icon={MemoryStick}
        label="RAM"
        valueClass="text-ink"
        value={
          memoryParts === null ? (
            "—"
          ) : (
            <>
              <span className={memoryAlert ? "text-danger" : undefined}>{memoryParts.used}</span>
              {" / "}
              {memoryParts.total}
            </>
          )
        }
      />
    </div>
  );
}
