import { Toast } from "@larness/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

it("announces a success message at the top and auto-dismisses", () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(<Toast message="搜索 Key 已添加" onDismiss={onDismiss} />);

  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("搜索 Key 已添加");
  expect(toast.className).toContain("top-4");
  expect(onDismiss).not.toHaveBeenCalled();

  act(() => {
    vi.advanceTimersByTime(3200);
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("keeps an error visible until the user closes it", () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(<Toast message="保存失败" tone="error" onDismiss={onDismiss} />);

  expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(screen.getByRole("alert")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "关闭错误消息" }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

it("offers a retry action for recoverable errors", () => {
  const onRetry = vi.fn();
  render(<Toast message="目录读取失败" tone="error" retry={{ label: "重试", run: onRetry }} />);

  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it("keeps the toast hidden without a message", () => {
  const onDismiss = vi.fn();
  const { rerender } = render(<Toast message={null} onDismiss={onDismiss} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  rerender(<Toast message="" onDismiss={onDismiss} />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
