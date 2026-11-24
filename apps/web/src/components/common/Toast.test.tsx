import { Dialog, DialogContent, DialogTitle, Toast } from "@larness/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
});

it("announces a success message at the top and auto-dismisses", () => {
  vi.useFakeTimers();
  const onDismiss = vi.fn();
  render(<Toast message="搜索 Key 已添加" onDismiss={onDismiss} />);

  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("搜索 Key 已添加");
  // 提示挂在 body 级全局层：视口顶部居中、位于 48px 顶栏之下，层级高于窗口/弹窗/预览。
  const layer = toast.closest("[data-larness-toast-layer]");
  expect(layer).not.toBeNull();
  expect(layer?.parentElement).toBe(document.body);
  expect(layer?.className).toContain("top-14");
  expect(layer?.className).toContain("z-[360]");
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

describe("stacking", () => {
  // 回归：输入区、结果卡片等调用点位于 `z-index` 堆叠上下文内部（例如输入区 z-10），
  // 就地渲染会被全局顶栏（z-50）与弹窗盖住。
  it("escapes a low z-index stacking context of its caller", () => {
    const { container } = render(
      <div className="relative z-10">
        <Toast message="每轮最多添加 8 个附件。" tone="error" />
      </div>,
    );
    const toast = screen.getByRole("alert");
    expect(container.contains(toast)).toBe(false);
    expect(toast.closest("[data-larness-toast-layer]")).not.toBeNull();
  });

  it("stays inside an open dialog so Radix does not hide or trap it", () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>联网设置</DialogTitle>
          <Toast message="搜索 Key 已添加" />
        </DialogContent>
      </Dialog>,
    );
    const toast = screen.getByRole("status");
    expect(toast.closest('[role="dialog"]')).not.toBeNull();
    expect(toast.closest("[data-larness-toast-layer]")).toBeNull();
  });

  // 回归：热更新会留下带旧类名的层节点（例如 `top-4` 时期），复用节点但不刷新
  // 类名会让提示继续被 48px 顶栏盖住。复用即自愈。
  it("repairs the classes of a reused layer from an older build", () => {
    render(<Toast message="第一次提示" />);
    const layer = document.querySelector<HTMLElement>("[data-larness-toast-layer]");
    expect(layer).not.toBeNull();
    if (!layer) return;
    layer.className =
      "pointer-events-none fixed inset-x-0 top-4 z-[360] flex flex-col items-center gap-2 px-4";
    expect(layer.className).toContain("top-4");

    // 另一次渲染会复用同一个层节点，此时必须把类名写回当前版本。
    render(<Toast message="第二次提示" />);
    expect(layer.className).toContain("top-14");
    expect(layer.className).not.toContain("top-4");
    expect(document.querySelectorAll("[data-larness-toast-layer]")).toHaveLength(1);
  });
});
