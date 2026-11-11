import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import type { HostMetrics } from "@larness/shared";

export interface CpuTimes {
  idle: number;
  total: number;
}

export interface DiskUsage {
  totalBytes: number;
  freeBytes: number;
}

export interface HostMetricsDeps {
  cpuTimes?: () => CpuTimes;
  memory?: () => { totalBytes: number; freeBytes: number };
  disk?: () => Promise<DiskUsage>;
  now?: () => number;
  cacheTtlMs?: number;
  onDiskError?: (error: unknown) => void;
}

const DEFAULT_CACHE_TTL_MS = 1_000;

export function readCpuTimes(): CpuTimes {
  let idle = 0;
  let total = 0;

  for (const cpu of cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }

  return { idle, total };
}

export function readMemoryUsage(): { totalBytes: number; freeBytes: number } {
  return { totalBytes: totalmem(), freeBytes: freemem() };
}

export async function readDiskUsage(path: string): Promise<DiskUsage> {
  const stats = await statfs(path);
  const blockSize = Number(stats.bsize);
  const totalBytes = Number(stats.blocks) * blockSize;
  const availableBlocks =
    typeof stats.bavail === "number" && Number.isFinite(stats.bavail) ? stats.bavail : stats.bfree;
  const freeBytes = Math.min(totalBytes, Number(availableBlocks) * blockSize);

  return { totalBytes, freeBytes };
}

/** Samples the machine running the Server, never the browser host. */
export class HostMetricsService {
  readonly #cpuTimes: () => CpuTimes;
  readonly #memory: () => { totalBytes: number; freeBytes: number };
  readonly #disk: () => Promise<DiskUsage>;
  readonly #now: () => number;
  readonly #cacheTtlMs: number;
  readonly #onDiskError: ((error: unknown) => void) | undefined;
  #previousCpu: CpuTimes | null;
  #cached: HostMetrics | null = null;
  #cachedAt = 0;

  constructor(deps: HostMetricsDeps = {}) {
    this.#cpuTimes = deps.cpuTimes ?? readCpuTimes;
    this.#memory = deps.memory ?? readMemoryUsage;
    this.#disk = deps.disk ?? (async () => ({ totalBytes: 0, freeBytes: 0 }));
    this.#now = deps.now ?? Date.now;
    this.#cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.#onDiskError = deps.onDiskError;
    this.#previousCpu = this.#cpuTimes();
  }

  async sample(): Promise<HostMetrics> {
    const now = this.#now();

    if (this.#cached !== null && now - this.#cachedAt < this.#cacheTtlMs) {
      return this.#cached;
    }

    const cpu = this.#cpuTimes();
    const previous = this.#previousCpu;
    this.#previousCpu = cpu;

    const totalDelta = previous === null ? 0 : cpu.total - previous.total;
    const idleDelta = previous === null ? 0 : cpu.idle - previous.idle;
    const cpuPercent =
      totalDelta > 0 ? Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100)) : 0;

    const memory = this.#memory();
    let disk: DiskUsage = { totalBytes: 0, freeBytes: 0 };

    try {
      disk = await this.#disk();
    } catch (error) {
      this.#onDiskError?.(error);
    }

    const metrics: HostMetrics = {
      cpuPercent,
      memoryUsedBytes: Math.max(0, memory.totalBytes - memory.freeBytes),
      memoryTotalBytes: memory.totalBytes,
      diskUsedBytes: Math.max(0, disk.totalBytes - disk.freeBytes),
      diskTotalBytes: disk.totalBytes,
      sampledAt: now,
    };

    this.#cached = metrics;
    this.#cachedAt = now;
    return metrics;
  }
}

export function createHostMetricsService(
  dataDir: string,
  deps: Omit<HostMetricsDeps, "disk"> = {},
): HostMetricsService {
  return new HostMetricsService({
    ...deps,
    disk: () => readDiskUsage(dataDir),
  });
}
