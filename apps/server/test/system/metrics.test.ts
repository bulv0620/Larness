import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type CpuTimes,
  HostMetricsService,
  readDiskUsage,
} from "../../src/modules/system/metrics.js";

const GIB = 1024 ** 3;

describe("HostMetricsService", () => {
  it("reports CPU delta, memory and disk usage from the injected readers", async () => {
    const reads: CpuTimes[] = [
      { idle: 100, total: 200 },
      { idle: 130, total: 300 },
    ];
    let readIndex = 0;
    const service = new HostMetricsService({
      cpuTimes: () => reads[Math.min(readIndex++, reads.length - 1)],
      memory: () => ({ totalBytes: 16 * GIB, freeBytes: 6 * GIB }),
      disk: async () => ({ totalBytes: 100, freeBytes: 25 }),
      now: () => 1_000,
      cacheTtlMs: 0,
    });

    const metrics = await service.sample();

    expect(metrics.cpuPercent).toBeCloseTo(70);
    expect(metrics.memoryUsedBytes).toBe(10 * GIB);
    expect(metrics.memoryTotalBytes).toBe(16 * GIB);
    expect(metrics.diskUsedBytes).toBe(75);
    expect(metrics.diskTotalBytes).toBe(100);
    expect(metrics.sampledAt).toBe(1_000);
  });

  it("returns zero CPU on the first sample instead of guessing", async () => {
    const service = new HostMetricsService({
      cpuTimes: () => ({ idle: 10, total: 20 }),
      memory: () => ({ totalBytes: 8 * GIB, freeBytes: 4 * GIB }),
      disk: async () => ({ totalBytes: 10, freeBytes: 5 }),
      now: () => 2_000,
      cacheTtlMs: 0,
    });

    expect((await service.sample()).cpuPercent).toBe(0);
  });

  it("caches samples for the configured interval", async () => {
    const cpuTimes = vi.fn(() => ({ idle: 10, total: 20 }));
    const service = new HostMetricsService({
      cpuTimes,
      memory: () => ({ totalBytes: 8 * GIB, freeBytes: 4 * GIB }),
      disk: async () => ({ totalBytes: 10, freeBytes: 5 }),
      now: () => 3_000,
      cacheTtlMs: 1_000,
    });

    const first = await service.sample();
    const second = await service.sample();

    expect(second).toBe(first);
    expect(cpuTimes).toHaveBeenCalledTimes(2);
  });

  it("keeps the endpoint usable when disk usage cannot be read", async () => {
    const onDiskError = vi.fn();
    const service = new HostMetricsService({
      cpuTimes: () => ({ idle: 10, total: 20 }),
      memory: () => ({ totalBytes: 8 * GIB, freeBytes: 4 * GIB }),
      disk: async () => {
        throw new Error("statfs failed");
      },
      now: () => 4_000,
      cacheTtlMs: 0,
      onDiskError,
    });

    const metrics = await service.sample();

    expect(metrics.diskTotalBytes).toBe(0);
    expect(metrics.diskUsedBytes).toBe(0);
    expect(onDiskError).toHaveBeenCalledOnce();
  });

  it("reads real disk sizes for the data directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "larness-metrics-"));
    try {
      const disk = await readDiskUsage(dir);
      expect(disk.totalBytes).toBeGreaterThan(0);
      expect(disk.freeBytes).toBeGreaterThanOrEqual(0);
      expect(disk.freeBytes).toBeLessThanOrEqual(disk.totalBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
