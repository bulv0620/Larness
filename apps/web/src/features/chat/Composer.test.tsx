import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

vi.mock("@/lib/queries", () => ({
  useSnapshot: () => ({
    data: { models: [{ id: "deepseek-default", label: "DeepSeek", maxContextTokens: 128000 }] },
  }),
}));
beforeEach(() => {
  useComposerStore.setState({ draft: "任务", policy: "standard", modelId: "deepseek-default" });
  useNavigationStore.setState({ sessionId: "test" });
  useTimelineStore.setState({ items: [], isStreaming: false, contextTokens: 32000 });
});
it("offers only the three existing approval policies and reflects each selection on the shield", async () => {
  const user = userEvent.setup();
  render(<Composer />);
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(3);
  expect(within(menu).queryByText(/上下文/)).toBeNull();
  await user.click(within(menu).getByRole("menuitemradio", { name: /严格审批/ }));
  expect(useComposerStore.getState().policy).toBe("strict");
  await user.click(screen.getByRole("button", { name: "审批策略：严格审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /只读/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "审批策略：只读" })).toBeVisible());
  expect(useComposerStore.getState().policy).toBe("readonly");
});
it("shows bounded context usage immediately before send/stop and distinguishes unknown usage", () => {
  render(<Composer />);
  const ring = screen.getByRole("progressbar", { name: "上下文用量" });
  expect(ring).toHaveAttribute("aria-valuenow", "25");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("32,000 / 128,000"));
  expect(ring.nextElementSibling).toBe(screen.getByRole("button", { name: "发送消息" }));
  act(() => useTimelineStore.setState({ contextTokens: 256000, isStreaming: true }));
  expect(ring).toHaveAttribute("aria-valuenow", "100");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("256,000"));
  expect(ring.nextElementSibling).toBe(screen.getByRole("button", { name: "停止执行" }));
  act(() => useTimelineStore.setState({ contextTokens: 0 }));
  expect(ring).not.toHaveAttribute("aria-valuenow");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("暂无统计"));
});
