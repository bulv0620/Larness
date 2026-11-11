import type { HostMetrics } from "@larness/shared";
import { TooltipProvider } from "@larness/ui";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HostMetricsIndicator } from "./HostMetricsIndicator";

const GIB = 1024 ** 3;

function renderIndicator(metrics: HostMetrics | null) {
  return render(
    <TooltipProvider>
      <HostMetricsIndicator metrics={metrics} />
    </TooltipProvider>,
  );
}

it("shows CPU, RAM and ROM ring gauges for the server host", () => {
  renderIndicator({
    cpuPercent: 23.4,
    memoryUsedBytes: 10 * GIB,
    memoryTotalBytes: 16 * GIB,
    diskUsedBytes: 300 * GIB,
    diskTotalBytes: 460 * GIB,
    sampledAt: 1_000,
  });

  expect(screen.getByLabelText("服务端系统资源")).toBeInTheDocument();
  expect(screen.getByText("23%")).toBeInTheDocument();
  expect(screen.getByText("63%")).toBeInTheDocument();
  expect(screen.getByText("65%")).toBeInTheDocument();
  expect(screen.getByText(/CPU.*23%/)).toBeInTheDocument();
  expect(screen.getByText(/RAM.*10\.0 \/ 16 GB（63%）/)).toBeInTheDocument();
  expect(screen.getByText(/ROM.*300 \/ 460 GB（65%）/)).toBeInTheDocument();
});

it("shows dashes until the first server sample arrives", () => {
  renderIndicator(null);

  expect(screen.getAllByText("—")).toHaveLength(3);
});

it("keeps exact byte values in the hover label", () => {
  const terabyte = 1024 * GIB;

  renderIndicator({
    cpuPercent: 0,
    memoryUsedBytes: 32 * GIB,
    memoryTotalBytes: 64 * GIB,
    diskUsedBytes: 1.5 * terabyte,
    diskTotalBytes: 4 * terabyte,
    sampledAt: 1_000,
  });

  expect(screen.getByText(/ROM.*1\.5 \/ 4\.0 TB（38%）/)).toBeInTheDocument();
  expect(screen.getByText(/RAM.*32\.0 \/ 64 GB（50%）/)).toBeInTheDocument();
});
