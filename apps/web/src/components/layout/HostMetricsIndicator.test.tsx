import type { HostMetrics } from "@larness/shared";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HostMetricsIndicator } from "./HostMetricsIndicator";

const GIB = 1024 ** 3;

function renderIndicator(metrics: HostMetrics | null) {
  return render(<HostMetricsIndicator metrics={metrics} />);
}

it("shows CPU percent and RAM used/total with icons instead of ring gauges", () => {
  renderIndicator({
    cpuPercent: 23.4,
    memoryUsedBytes: 10 * GIB,
    memoryTotalBytes: 16 * GIB,
    diskUsedBytes: 300 * GIB,
    diskTotalBytes: 460 * GIB,
    sampledAt: 1_000,
  });

  expect(screen.getByText("服务端资源占用")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("23%")).toBeInTheDocument();

  const ramUsed = screen.getByText("10.0");
  expect(ramUsed.parentElement?.textContent).toBe("10.0 / 16 GB");
  expect(screen.queryByText(/ROM/)).toBeNull();
});

it("shows dashes until the first server sample arrives", () => {
  renderIndicator(null);

  expect(screen.getAllByText("—")).toHaveLength(2);
});

it("keeps TB formatting for large memory values", () => {
  const tib = 1024 * GIB;

  renderIndicator({
    cpuPercent: 0,
    memoryUsedBytes: 1.5 * tib,
    memoryTotalBytes: 4 * tib,
    diskUsedBytes: 0,
    diskTotalBytes: 460 * GIB,
    sampledAt: 1_000,
  });

  expect(screen.getByText("1.5").parentElement?.textContent).toBe("1.5 / 4.0 TB");
});

it("turns CPU percent and RAM used text red above 90 percent", () => {
  renderIndicator({
    cpuPercent: 96,
    memoryUsedBytes: 15.2 * GIB, // 95%
    memoryTotalBytes: 16 * GIB,
    diskUsedBytes: 0,
    diskTotalBytes: 460 * GIB,
    sampledAt: 1_000,
  });

  expect(screen.getByText("96%")).toHaveClass("text-danger");
  expect(screen.getByText("15.2")).toHaveClass("text-danger");
  expect(screen.getByText("15.2").parentElement).toHaveClass("text-ink");
});

it("keeps normal ink color at exactly 90 percent", () => {
  renderIndicator({
    cpuPercent: 90,
    memoryUsedBytes: 14.4 * GIB, // 90%
    memoryTotalBytes: 16 * GIB,
    diskUsedBytes: 0,
    diskTotalBytes: 460 * GIB,
    sampledAt: 1_000,
  });

  expect(screen.getByText("90%")).toHaveClass("text-ink");
  expect(screen.getByText("14.4").parentElement).toHaveClass("text-ink");
});
