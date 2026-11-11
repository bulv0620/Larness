import type { HostMetrics } from "@larness/shared";
import { Hint } from "@larness/ui";
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
    <Hint label={hint}>
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
    </Hint>
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
    <section aria-label="服务端系统资源" className="mr-1 hidden items-center gap-3 xl:flex">
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
  );
}
