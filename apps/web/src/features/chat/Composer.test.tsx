import { TooltipProvider } from "@larness/ui";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

vi.mock("@/lib/env", () => ({ USE_MOCKS: true }));
vi.mock("@/lib/queries", async (importOriginal) => {
  const deepseekGroup = {
    provider: "deepseek",
    billing: "usage",
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
        capabilities: { inputModalities: ["text", "image"], tools: true },
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
    billing: "subscription",
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
    ...(await importOriginal<typeof import("@/lib/queries")>()),
    useSessionDetail: () => null,
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
  const options = within(menu).getAllByRole("menuitemradio");
  expect(options).toEqual([
    within(menu).getByRole("menuitemradio", { name: /^只读/ }),
    within(menu).getByRole("menuitemradio", { name: /^严格审批/ }),
    within(menu).getByRole("menuitemradio", { name: /^标准审批/ }),
    within(menu).getByRole("menuitemradio", { name: /^完全自主/ }),
  ]);
  expect(within(menu).queryByText(/上下文/)).toBeNull();
  await user.click(within(menu).getByRole("menuitemradio", { name: /严格审批/ }));
  await user.click(screen.getByRole("button", { name: "审批策略：严格审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /只读/ }));
  await waitFor(() => expect(screen.getByRole("button", { name: "审批策略：只读" })).toBeVisible());
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
  expect(
    screen.getByRole("button", { name: "审批策略：标准审批", hidden: true }),
  ).toBeInTheDocument();
  const dialog = await screen.findByRole("dialog", { name: "启用完全自主？" });
  expect(dialog).toHaveTextContent("程序以本机账户权限运行，可访问项目外文件和网络。");
  await user.click(within(dialog).getByRole("button", { name: "取消" }));
  expect(
    screen.getByRole("button", { name: "审批策略：标准审批", hidden: true }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /完全自主/ }));
  await user.click(await screen.findByRole("button", { name: "确认启用" }));
  expect(screen.getByRole("button", { name: "审批策略：完全自主" })).toBeVisible();
});

it("switches Key groups and thinking without displaying the Key on the trigger", async () => {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <Composer />
    </TooltipProvider>,
  );
  const trigger = screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 中" });
  expect(trigger).not.toHaveTextContent("DeepSeek Key");
  await user.click(trigger);
  const popover = await screen.findByRole("dialog", { name: "模型与思考" });
  expect(within(popover).getByRole("button", { name: /DeepSeek Key.*按量/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(within(popover).getByRole("button", { name: "DeepSeek Flash" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(within(popover).getByLabelText(/支持截图.*支持工具/)).toBeVisible();
  expect(within(popover).queryByRole("button", { name: "GLM-4.6" })).toBeNull();
  await user.click(within(popover).getByRole("button", { name: "高" }));
  expect(trigger).toHaveAccessibleName("模型与思考：DeepSeek Flash · 高");

  await user.click(trigger);
  const search = screen.getByRole("searchbox", { name: "搜索 Key 或模型" });
  await user.type(search, "glm-4.6");
  const reopened = screen.getByRole("dialog", { name: "模型与思考" });
  expect(within(reopened).queryByRole("button", { name: /DeepSeek Key/ })).toBeNull();
  expect(within(reopened).getByRole("button", { name: /GLM Key.*套餐额度/ })).toBeVisible();
  await user.click(within(reopened).getByRole("button", { name: "GLM-4.6" }));
  const switchNotice = screen.getByText("已切换到 GLM-4.6");
  expect(switchNotice).toBeVisible();
  expect(switchNotice).toHaveClass("absolute", "bottom-full");

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: /^关闭$/ }));
  expect(trigger).toHaveAccessibleName("模型与思考：GLM-4.6 · 关闭");

  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "模型与思考" })).toBeNull();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: /DeepSeek Key/ }));
  await user.click(screen.getByRole("button", { name: "DeepSeek Chat" }));
  expect(screen.getByText("已切换到 DeepSeek Chat")).toBeVisible();
  expect(trigger).toHaveAccessibleName("模型与思考：DeepSeek Chat");
  expect(trigger).not.toHaveTextContent(/Key|不支持/);
  expect(screen.getByRole("progressbar", { name: "上下文用量" })).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("暂无统计"),
  );
});
