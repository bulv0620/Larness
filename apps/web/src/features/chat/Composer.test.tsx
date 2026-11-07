import { TooltipProvider } from "@larness/ui";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

vi.mock("@/lib/queries", () => {
  const deepseekGroup = {
    provider: "deepseek",
    credentialProfileId: "cred_mock",
    credentialLabel: "DeepSeek Key",
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
            { id: "medium", label: "中" },
            { id: "high", label: "高" },
          ],
        },
        default: true,
      },
      {
        id: "deepseek-chat",
        label: "DeepSeek Chat",
        contextWindow: 128000,
        thinking: { supported: false, levels: [] },
        default: false,
      },
    ],
  };
  const glmGroup = {
    provider: "glm",
    credentialProfileId: "cred_glm",
    credentialLabel: "GLM Key",
    syncedAt: 1,
    stale: false,
    lastRefreshError: null,
    models: [
      {
        id: "glm-4.6",
        label: "GLM-4.6",
        contextWindow: 200000,
        thinking: { supported: true, mode: "toggle", levels: [] },
        default: true,
      },
    ],
  };

  return {
    useSessionModel: () => null,
    useModelCatalog: () => ({
      catalog: { ...deepseekGroup, groups: [deepseekGroup, glmGroup] },
      isPending: false,
      error: null,
      refetch: async () => undefined,
    }),
  };
});
beforeEach(() => {
  useComposerStore.setState({
    draft: "任务",
    policy: "standard",
    modelId: "deepseek-flash",
    thinking: "medium",
  });
  useNavigationStore.setState({ sessionId: "test" });
  useTimelineStore.setState({
    items: [],
    isStreaming: false,
    modelUsage: {
      "deepseek-flash": { inputTokens: 32_000, contextWindow: 128_000, updatedAt: 1 },
    },
  });
});
it("offers the approval policies and reflects each selection on the shield", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
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
  render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
  const ring = screen.getByRole("progressbar", { name: "上下文用量" });
  expect(ring).toHaveAttribute("aria-valuenow", "25");
  expect(ring).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("单次输入：32,000 / 128,000"),
  );
  expect(ring.nextElementSibling).toBe(screen.getByRole("button", { name: "发送消息" }));
  act(() =>
    useTimelineStore.setState({
      modelUsage: {
        "deepseek-flash": { inputTokens: 256_000, contextWindow: 128_000, updatedAt: 2 },
      },
      isStreaming: true,
    }),
  );
  expect(ring).toHaveAttribute("aria-valuenow", "100");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("256,000"));
  expect(ring.nextElementSibling).toBe(screen.getByRole("button", { name: "停止执行" }));
  act(() => useTimelineStore.setState({ modelUsage: {} }));
  expect(ring).not.toHaveAttribute("aria-valuenow");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("暂无统计"));
});

it("requires risk confirmation before switching to autonomous, with cancellation preserving policy", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
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

it("switches model and thinking from the two-level menu", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
  await user.click(screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 中" }));
  const popover = await screen.findByRole("dialog", { name: "模型与思考" });
  expect(within(popover).getByRole("button", { name: "模型：DeepSeek Flash" })).toBeVisible();
  expect(within(popover).getByRole("button", { name: "思考等级：中" })).toBeVisible();

  await user.click(within(popover).getByRole("button", { name: "思考等级：中" }));
  await user.click(within(popover).getByRole("button", { name: "高" }));
  expect(useComposerStore.getState().thinking).toBe("high");
  expect(screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 高" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 高" }));
  const reopened = screen.getByRole("dialog", { name: "模型与思考" });
  await user.click(within(reopened).getByRole("button", { name: "模型：DeepSeek Flash" }));
  expect(within(reopened).getByText("DeepSeek · DeepSeek Key")).toBeVisible();
  expect(within(reopened).getByText("GLM · GLM Key")).toBeVisible();
  expect(within(reopened).queryByText("Hidden Model")).toBeNull();
  expect(within(reopened).queryByText("Unknown Window")).toBeNull();

  await user.click(within(reopened).getByRole("button", { name: /GLM-4.6/ }));
  expect(useComposerStore.getState().modelId).toBe("glm-4.6");
  expect(useComposerStore.getState().credentialProfileId).toBe("cred_glm");
  expect(useComposerStore.getState().thinking).toBe("on");
  expect(screen.getByText("已切换到 GLM-4.6")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "模型与思考：GLM-4.6 · 开启" }));
  const glmPopover = screen.getByRole("dialog", { name: "模型与思考" });
  await user.click(within(glmPopover).getByRole("button", { name: "思考等级：开启" }));
  expect(within(glmPopover).getByRole("button", { name: "关闭" })).toBeVisible();
  await user.click(within(glmPopover).getByRole("button", { name: "关闭" }));
  expect(useComposerStore.getState().thinking).toBe("off");
  expect(screen.getByRole("button", { name: "模型与思考：GLM-4.6 · 关闭" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "模型与思考：GLM-4.6 · 关闭" }));
  const again = screen.getByRole("dialog", { name: "模型与思考" });
  await user.click(within(again).getByRole("button", { name: "模型：GLM-4.6" }));
  await user.click(within(again).getByRole("button", { name: /DeepSeek Chat/ }));
  expect(useComposerStore.getState().modelId).toBe("deepseek-chat");
  expect(useComposerStore.getState().credentialProfileId).toBe("cred_mock");
  expect(useComposerStore.getState().thinking).toBe("off");
  expect(screen.getByText("已切换到 DeepSeek Chat")).toBeVisible();
  expect(screen.getByRole("button", { name: "模型与思考：DeepSeek Chat · 不支持" })).toBeVisible();
  expect(screen.getByRole("progressbar", { name: "上下文用量" })).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("暂无统计"),
  );
});
