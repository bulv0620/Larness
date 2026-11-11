import type { HostMetrics } from "@larness/shared";
import { Cpu, HardDrive, type LucideIcon, MemoryStick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

function HostMetric({ label, value, percent, color }: HostMetricProps) {
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
    <div className="w-[264px] space-y-2.5">
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
  );
}

export function HostMetricsIndicator({ metrics }: { metrics: HostMetrics | null }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const cpuPercent = metrics === null ? null : Math.min(100, Math.max(0, metrics.cpuPercent));
  const memoryPercent = usedPercent(metrics?.memoryUsedBytes ?? 0, metrics?.memoryTotalBytes ?? 0);
  const diskPercent = usedPercent(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0);
  const memoryValue = formatBytesPair(
    metrics?.memoryUsedBytes ?? 0,
    metrics?.memoryTotalBytes ?? 0,
  );
  const diskValue = formatBytesPair(metrics?.diskUsedBytes ?? 0, metrics?.diskTotalBytes ?? 0);
  const hasMemory = metrics !== null && metrics.memoryTotalBytes > 0;
  const hasDisk = metrics !== null && metrics.diskTotalBytes > 0;
  const cpuValue = cpuPercent === null ? "—" : `${Math.round(cpuPercent)}%`;
  const memoryDetail = hasMemory ? `${memoryValue}（${Math.round(memoryPercent)}%）` : "—";
  const diskDetail = hasDisk ? `${diskValue}（${Math.round(diskPercent)}%）` : "—";
  const summary = `CPU：${cpuValue}；RAM：${memoryDetail}；ROM：${diskDetail}`;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative mr-1 hidden xl:block">
      <button
        ref={buttonRef}
        type="button"
        aria-label="服务端资源占用"
        aria-expanded={open}
        aria-controls="host-metrics-popover"
        aria-describedby="host-metrics-summary"
        onClick={() => setOpen((current) => !current)}
        className={`flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1 transition-[background-color,box-shadow] duration-200 ${
          open
            ? "bg-surface-2/80 ring-2 ring-accent/25"
            : "hover:bg-surface-2/70 hover:ring-2 hover:ring-accent/20"
        }`}
      >
        <HostMetric label="CPU" value={cpuValue} percent={cpuPercent ?? 0} color="var(--accent)" />
        <HostMetric
          label="RAM"
          value={!hasMemory ? "—" : `${Math.round(memoryPercent)}%`}
          percent={metrics === null ? 0 : memoryPercent}
          color="var(--success)"
        />
        <HostMetric
          label="ROM"
          value={!hasDisk ? "—" : `${Math.round(diskPercent)}%`}
          percent={metrics === null ? 0 : diskPercent}
          color="var(--warning)"
        />
        <span id="host-metrics-summary" className="sr-only">
          {summary}
        </span>
      </button>

      {open ? (
        <div
          id="host-metrics-popover"
          role="dialog"
          aria-label="服务端资源详情"
          className="absolute left-1/2 top-full z-[200] mt-4 -translate-x-1/2 rounded-2xl border border-line bg-surface p-3 shadow-pop"
        >
          <span className="pointer-events-none absolute -top-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-l border-t border-line bg-surface" />
          <MetricsDetails metrics={metrics} />
        </div>
      ) : null}
    </div>
  );
}
