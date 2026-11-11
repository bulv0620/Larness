import type { HostMetrics } from "@larness/shared";
import { Hint } from "@larness/ui";
import { Cpu, HardDrive, type LucideIcon, MemoryStick } from "lucide-react";
import { formatBytesPair, usedPercent } from "@/lib/format";

interface HostMetricProps {
  icon: LucideIcon;
  label: string;
  value: string;
  barPercent: number;
  hint: string;
}

function HostMetric({ icon: Icon, label, value, barPercent, hint }: HostMetricProps) {
  return (
    <Hint label={hint}>
      <span className="flex items-center gap-1.5">
        <Icon size={12} className="shrink-0 text-ink-3" />
        <span className="font-mono text-[9px] text-ink-3">{label}</span>
        <span className="h-1 w-8 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]">
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-700"
            style={{ width: `${barPercent}%` }}
          />
        </span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-2">{value}</span>
      </span>
    </Hint>
  );
}

export function HostMetricsIndicator({ metrics }: { metrics: HostMetrics | null }) {
  const cpuPercent = metrics === null ? null : Math.min(100, Math.max(0, metrics.cpuPercent));

  return (
    <section
      aria-label="服务端系统资源"
      className="mx-1 hidden items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1 xl:flex"
    >
      <HostMetric
        icon={Cpu}
        label="CPU"
        value={cpuPercent === null ? "—" : `${Math.round(cpuPercent)}%`}
        barPercent={cpuPercent ?? 0}
        hint="运行 Larness Server 的机器 CPU 使用率"
      />
      <span className="h-3 w-px shrink-0 bg-line" />
      <HostMetric
        icon={MemoryStick}
        label="RAM"
        value={formatBytesPair(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0)}
        barPercent={usedPercent(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0)}
        hint="运行 Larness Server 的机器内存占用"
      />
      <span className="h-3 w-px shrink-0 bg-line" />
      <HostMetric
        icon={HardDrive}
        label="ROM"
        value={formatBytesPair(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0)}
        barPercent={usedPercent(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0)}
        hint="运行 Larness Server 的机器磁盘占用（数据目录所在卷）"
      />
    </section>
  );
}
