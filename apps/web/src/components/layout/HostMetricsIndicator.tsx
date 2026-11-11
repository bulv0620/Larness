import type { HostMetrics } from "@larness/shared";
import { Hint } from "@larness/ui";
import { Cpu, HardDrive, type LucideIcon, MemoryStick } from "lucide-react";
import { formatBytesPair, usedPercent } from "@/lib/format";

const RING_SIZE = 22;
const RING_STROKE = 2.2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

interface HostMetricProps {
  label: string;
  value: string;
  percent: number;
  color: string;
  hint: string;
}

interface DetailRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
  percent: number;
  color: string;
}

function MetricRing({ percent, color }: { percent: number; color: string }) {
  const offset = RING_CIRCUMFERENCE * (1 - percent / 100);

  return (
    <svg
      aria-hidden="true"
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
      className="-rotate-90"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={RING_STROKE}
        className="text-ink-3/20"
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke={color}
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        className="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  );
}

function HostMetric({ label, value, percent, color, hint }: HostMetricProps) {
  return (
    <span className="flex items-center gap-1.5">
      <MetricRing percent={percent} color={color} />
      <span aria-hidden="true" className="flex flex-col leading-none">
        <span className="text-[8px] font-medium uppercase tracking-[.09em] text-ink-3">
          {label}
        </span>
        <span className="mt-0.5 font-mono text-[10px] font-medium tabular-nums text-ink">
          {value}
        </span>
      </span>
      <span className="sr-only">{`${label}：${hint}`}</span>
    </span>
  );
}

function DetailRow({ icon: Icon, label, value, percent, color }: DetailRowProps) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon size={13} strokeWidth={1.9} className="shrink-0" style={{ color }} />
      <span className="w-8 text-[9px] font-medium uppercase tracking-[.08em] text-ink-3">
        {label}
      </span>
      <span className="block h-1 flex-1 overflow-hidden rounded-full bg-ink/10">
        <span
          className="block h-full rounded-full transition-[width] duration-700"
          style={{ width: `${percent}%`, background: color }}
        />
      </span>
      <span className="w-[92px] text-right font-mono text-[10px] tabular-nums text-ink-2">
        {value}
      </span>
    </div>
  );
}

function MetricsDetails({ metrics }: { metrics: HostMetrics | null }) {
  const memoryPercent = usedPercent(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0);
  const diskPercent = usedPercent(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0);
  const cpuPercent = metrics === null ? 0 : Math.min(100, Math.max(0, metrics.cpuPercent));

  return (
    <div className="w-[264px]">
      <div className="mb-2.5 flex items-center justify-between border-b border-line pb-2">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="text-[10.5px] font-semibold text-ink">服务端资源</span>
        </span>
        <span className="rounded-full bg-surface-2 px-1.5 py-[1px] font-mono text-[8px] text-ink-3">
          4s
        </span>
      </div>
      <div className="space-y-2.5">
        <DetailRow
          icon={Cpu}
          label="CPU"
          value={metrics === null ? "—" : `${Math.round(cpuPercent)}%`}
          percent={cpuPercent}
          color="var(--accent)"
        />
        <DetailRow
          icon={MemoryStick}
          label="RAM"
          value={formatBytesPair(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0)}
          percent={metrics === null ? 0 : memoryPercent}
          color="var(--success)"
        />
        <DetailRow
          icon={HardDrive}
          label="ROM"
          value={formatBytesPair(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0)}
          percent={metrics === null ? 0 : diskPercent}
          color="var(--warning)"
        />
      </div>
    </div>
  );
}

export function HostMetricsIndicator({ metrics }: { metrics: HostMetrics | null }) {
  const memoryPercent = usedPercent(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0);
  const diskPercent = usedPercent(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0);
  const memoryValue = formatBytesPair(
    metrics?.memoryUsedBytes ?? 0,
    metrics?.memoryTotalBytes ?? 0,
  );
  const diskValue = formatBytesPair(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0);
  const cpuPercent = metrics === null ? null : Math.min(100, Math.max(0, metrics.cpuPercent));
  const hasMemory = metrics !== null && metrics.memoryTotalBytes > 0;
  const hasDisk = metrics !== null && metrics.diskTotalBytes > 0;

  return (
    <Hint variant="card" label={<MetricsDetails metrics={metrics} />}>
      <section
        aria-label="服务端系统资源"
        className="mr-1 hidden cursor-pointer items-center gap-3 rounded-xl px-2 py-1 transition-[background-color,box-shadow] duration-200 hover:bg-surface-2/70 hover:ring-2 hover:ring-accent/20 data-[state=delayed-open]:bg-surface-2/80 data-[state=delayed-open]:ring-2 data-[state=delayed-open]:ring-accent/25 xl:flex"
      >
        <HostMetric
          label="CPU"
          value={cpuPercent === null ? "—" : `${Math.round(cpuPercent)}%`}
          percent={cpuPercent ?? 0}
          color="var(--accent)"
          hint={
            cpuPercent === null
              ? "运行 Larness Server 的机器 CPU 使用率：—"
              : `运行 Larness Server 的机器 CPU 使用率：${Math.round(cpuPercent)}%`
          }
        />
        <HostMetric
          label="RAM"
          value={!hasMemory ? "—" : `${Math.round(memoryPercent)}%`}
          percent={metrics === null ? 0 : memoryPercent}
          color="var(--success)"
          hint={
            metrics === null
              ? "运行 Larness Server 的机器内存占用：—"
              : `运行 Larness Server 的机器内存占用：${memoryValue}（${Math.round(memoryPercent)}%）`
          }
        />
        <HostMetric
          label="ROM"
          value={!hasDisk ? "—" : `${Math.round(diskPercent)}%`}
          percent={metrics === null ? 0 : diskPercent}
          color="var(--warning)"
          hint={
            metrics === null
              ? "运行 Larness Server 的机器磁盘占用：—"
              : `运行 Larness Server 的机器磁盘占用（数据目录所在卷）：${diskValue}（${Math.round(diskPercent)}%）`
          }
        />
      </section>
    </Hint>
  );
}
