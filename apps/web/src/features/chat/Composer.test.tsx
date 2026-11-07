import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

vi.mock("@/lib/queries", () => ({
  useSessionModel: () => null,
  useModelCatalog: () => ({
    catalog: {
      provider: "deepseek",
      credentialProfileId: "cred_mock",
      syncedAt: 1,
      stale: false,
      lastRefreshError: null,
      models: [
        {
          id: "deepseek-flash",
          label: "DeepSeek Flash",
          contextWindow: 128000,
          thinking: {
            supported: true,
            levels: [
              { id: "low", label: "低" },
              { id: "high", label: "高" },
              { id: "max", label: "最高" },
            ],
          },
          default: true,
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: async () => undefined,
  }),
}));
beforeEach(() => {
  useComposerStore.setState({
    draft: "任务",
    policy: "standard",
    modelId: "deepseek-flash",
    thinking: "default",
  });
  useNavigationStore.setState({ sessionId: "test" });
  useTimelineStore.setState({ items: [], isStreaming: false, contextTokens: 32000 });
});
it("offers the approval policies and reflects each selection on the shield", async () => {
  const user = userEvent.setup();
  render(<Composer />);
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(4);
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

it("requires risk confirmation before switching to autonomous, with cancellation preserving policy", async () => {
  const user = userEvent.setup();
  render(<Composer />);
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /完全自主/ }));
  expect(useComposerStore.getState().policy).toBe("standard");
  const dialog = await screen.findByRole("dialog", { name: "启用完全自主？" });
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(useComposerStore.getState().policy).toBe("standard");
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /完全自主/ }));
  await user.click(await screen.findByRole("button", { name: "确认启用" }));
  expect(useComposerStore.getState().policy).toBe("autonomous");
  expect(screen.getByRole("button", { name: "审批策略：完全自主" })).toBeVisible();
});

it("switches model and thinking level from the composer picker", async () => {
  const user = userEvent.setup();
  render(<Composer />);
  await user.click(screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 默认" }));
  const menu = screen.getByRole("menu");
  expect(within(menu).getByRole("menuitemradio", { name: /DeepSeek Flash/ })).toBeChecked();
  await user.click(within(menu).getByRole("menuitemradio", { name: "高" }));
  expect(useComposerStore.getState().thinking).toBe("high");
  expect(screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 高" })).toBeVisible();
});
