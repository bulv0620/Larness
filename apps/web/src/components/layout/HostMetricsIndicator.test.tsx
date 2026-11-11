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

it("shows CPU, RAM and ROM usage for the server host", () => {
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
  expect(screen.getByText("10.0 / 16 GB")).toBeInTheDocument();
  expect(screen.getByText("300 / 460 GB")).toBeInTheDocument();
});

it("shows dashes until the first server sample arrives", () => {
  renderIndicator(null);

  expect(screen.getAllByText("—")).toHaveLength(3);
});

it("renders terabyte volumes with one shared unit", () => {
  const terabyte = 1024 * GIB;

  renderIndicator({
    cpuPercent: 0,
    memoryUsedBytes: 32 * GIB,
    memoryTotalBytes: 64 * GIB,
    diskUsedBytes: 1.5 * terabyte,
    diskTotalBytes: 4 * terabyte,
    sampledAt: 1_000,
  });

  expect(screen.getByText("1.5 / 4.0 TB")).toBeInTheDocument();
  expect(screen.getByText("32.0 / 64 GB")).toBeInTheDocument();
});
