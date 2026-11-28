import { TooltipProvider } from "@larness/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { queryClient, useSessionDetail, useWebSearchSettings } from "@/lib/queries";
import { updateSession } from "@/lib/workspaceApi";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { turnState, useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

vi.mock("@/lib/env", () => ({ USE_MOCKS: true }));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  updateSession: vi.fn(),
}));
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
    useSessionDetail: vi.fn(() => null),
    useWebSearchSettings: vi.fn(() => ({
      data: {
        activeConnectionId: null,
        maxResults: 5,
        maxSearchesPerTurn: 6,
        maxFetchesPerTurn: 4,
        connections: [],
      },
      isPending: false,
      error: null,
      refetch: async () => undefined,
    })),
    useModelCatalog: () => ({
      catalog: { ...deepseekGroup, groups: [deepseekGroup, glmGroup] },
      isPending: false,
      error: null,
      refetch: async () => undefined,
    }),
  };
});
beforeEach(() => {
  vi.mocked(useSessionDetail).mockReturnValue(null);
  vi.mocked(useWebSearchSettings).mockReturnValue({
    data: {
      activeConnectionId: null,
      maxResults: 5,
      maxSearchesPerTurn: 6,
      maxFetchesPerTurn: 4,
      connections: [],
    },
    isPending: false,
    error: null,
    refetch: async () => undefined,
  });
  useComposerStore.setState({
    draft: "任务",
  });
  useNavigationStore.setState({ sessionId: "test" });
  useTimelineStore.setState({
    items: [],
    turn: turnState(),
    modelUsage: {
      "deepseek-flash": { inputTokens: 32_000, contextWindow: 128_000, updatedAt: 1 },
    },
  });
});
function renderComposer() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Composer />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

it("offers the approval policies and reflects each selection on the shield", async () => {
  const user = userEvent.setup();
  renderComposer();
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
it("puts context usage in the row under the composer and the attachment button before send/stop", () => {
  renderComposer();
  const ring = screen.getByRole("progressbar", { name: "上下文用量" });
  expect(ring).toHaveAttribute("aria-valuenow", "25");
  expect(ring).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("本轮请求输入：32,000 / 128,000"),
  );
  expect(within(screen.getByRole("status", { name: "会话用量" })).getByRole("progressbar")).toBe(
    ring,
  );
  const attachment = screen.getByRole("button", { name: "添加附件" });
  expect(attachment.nextElementSibling).toBe(screen.getByRole("button", { name: "发送消息" }));
  act(() =>
    useTimelineStore.setState({
      modelUsage: {
        "deepseek-flash": { inputTokens: 256_000, contextWindow: 128_000, updatedAt: 2 },
      },
      turn: turnState("running", "turn_composer", 1),
    }),
  );
  expect(ring).toHaveAttribute("aria-valuenow", "100");
  expect(ring).toHaveAttribute("aria-valuetext", expect.stringContaining("256,000"));
  expect(attachment.nextElementSibling).toBe(screen.getByRole("button", { name: "停止执行" }));
  act(() => useTimelineStore.setState({ modelUsage: {} }));
  // No request recorded in this session: the row is gone instead of showing a
  // fake zero.
  expect(screen.queryByRole("status", { name: "会话用量" })).toBeNull();
  expect(screen.queryByRole("progressbar", { name: "上下文用量" })).toBeNull();
});

it("keeps the usage row out of a session before its first request", () => {
  useTimelineStore.setState({ modelUsage: {} });
  renderComposer();
  expect(screen.queryByRole("status", { name: "会话用量" })).toBeNull();

  act(() =>
    useTimelineStore.setState({
      modelUsage: {
        "deepseek-flash": { inputTokens: 12_000, contextWindow: 128_000, updatedAt: 2 },
      },
    }),
  );
  const row = screen.getByRole("status", { name: "会话用量" });
  expect(within(row).getByRole("progressbar", { name: "上下文用量" })).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("本轮请求输入：12,000 / 128,000"),
  );
});

it("requires risk confirmation before switching to autonomous, with cancellation preserving policy", async () => {
  const user = userEvent.setup();
  renderComposer();
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

it("opens separate model and thinking submenus with small Key headings", async () => {
  const user = userEvent.setup();
  renderComposer();
  const trigger = screen.getByRole("button", { name: "模型与思考：DeepSeek Flash · 中" });
  expect(trigger).not.toHaveTextContent("DeepSeek Key");
  await user.click(trigger);
  const popover = () => within(screen.getByRole("dialog", { name: "模型与思考" }));
  expect(popover().getAllByRole("button")).toEqual([
    popover().getByRole("button", { name: "模型：DeepSeek Flash" }),
    popover().getByRole("button", { name: "思考强度：中" }),
  ]);
  await user.click(popover().getByRole("button", { name: "思考强度：中" }));
  await user.click(popover().getByRole("button", { name: "高" }));
  expect(trigger).toHaveAccessibleName("模型与思考：DeepSeek Flash · 高");

  await user.click(trigger);
  await user.click(popover().getByRole("button", { name: "模型：DeepSeek Flash" }));
  expect(popover().getByRole("list", { name: "GLM Key" })).toBeVisible();
  expect(popover().queryByRole("button", { name: /GLM Key/ })).toBeNull();
  expect(popover().getByRole("button", { name: "DeepSeek Flash" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(popover().getByRole("button", { name: "GLM-4.6" }));
  const switchNotice = screen.getByText("已切换到 GLM-4.6");
  expect(switchNotice).toBeVisible();
  expect(switchNotice).toHaveClass("absolute", "bottom-full");

  await user.click(trigger);
  await user.click(popover().getByRole("button", { name: "思考强度：开启" }));
  await user.click(popover().getByRole("button", { name: /^关闭$/ }));
  expect(trigger).toHaveAccessibleName("模型与思考：GLM-4.6 · 关闭");

  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "模型与思考" })).toBeNull();
  expect(trigger).toHaveFocus();

  await user.click(trigger);
  await user.click(popover().getByRole("button", { name: "模型：GLM-4.6" }));
  await user.click(popover().getByRole("button", { name: "DeepSeek Chat" }));
  expect(screen.getByText("已切换到 DeepSeek Chat")).toBeVisible();
  expect(trigger).toHaveAccessibleName("模型与思考：DeepSeek Chat");
  expect(trigger).not.toHaveTextContent(/Key|不支持/);
  // DeepSeek Chat has no recorded request here: no row instead of a 0% ring.
  expect(screen.queryByRole("progressbar", { name: "上下文用量" })).toBeNull();
});
it("replaces the context shortcut with a globe that toggles web search", async () => {
  vi.mocked(useSessionDetail).mockReturnValue({
    id: "test",
    webSearchEnabled: false,
    approvalPolicyId: "standard",
    agentProfile: "coding",
  } as never);
  vi.mocked(useWebSearchSettings).mockReturnValue({
    data: {
      activeConnectionId: "wsc_1",
      maxResults: 5,
      maxSearchesPerTurn: 6,
      maxFetchesPerTurn: 4,
      connections: [
        {
          id: "wsc_1",
          provider: "deepseek",
          label: "DeepSeek 搜索",
          region: null,
          endpoint: "https://api.deepseek.com",
          maskedKey: "••••••",
          createdAt: 1,
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: async () => undefined,
  });
  vi.mocked(updateSession).mockResolvedValue({ webSearchEnabled: true } as never);
  const user = userEvent.setup();
  renderComposer();

  expect(screen.queryByRole("button", { name: "添加上下文" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "联网搜索：已关闭" }));
  await waitFor(() =>
    expect(updateSession).toHaveBeenCalledWith("test", { webSearchEnabled: true }),
  );
});
it("disables the globe when no web search key is configured", () => {
  renderComposer();

  expect(screen.getByRole("button", { name: "联网搜索：未配置" })).toBeDisabled();
  expect(updateSession).not.toHaveBeenCalled();
});

it("presets web search on a draft session without calling the session API", async () => {
  vi.mocked(useWebSearchSettings).mockReturnValue({
    data: {
      activeConnectionId: "wsc_1",
      maxResults: 5,
      maxSearchesPerTurn: 6,
      maxFetchesPerTurn: 4,
      connections: [
        {
          id: "wsc_1",
          provider: "deepseek",
          label: "DeepSeek 搜索",
          region: null,
          endpoint: "https://api.deepseek.com",
          maskedKey: "••••••",
          createdAt: 1,
        },
      ],
    },
    isPending: false,
    error: null,
    refetch: async () => undefined,
  });
  useNavigationStore.setState({ projectId: null, draftSession: null, sessionId: "" });
  useNavigationStore.getState().startDraft(null);
  useTimelineStore.setState({ sessionId: useNavigationStore.getState().sessionId });
  const user = userEvent.setup();
  renderComposer();

  const globe = screen.getByRole("button", { name: "联网搜索：已关闭" });
  expect(globe).toBeEnabled();
  await user.click(globe);

  expect(screen.getByRole("button", { name: "联网搜索：已开启" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(useNavigationStore.getState().draftSession?.webSearchEnabled).toBe(true);
  expect(screen.getByText("已开启联网搜索")).toBeVisible();
  expect(updateSession).not.toHaveBeenCalled();
});

it("keeps the usage row out of a brand-new session even with stale per-model usage", () => {
  useNavigationStore.setState({ projectId: null, draftSession: null, sessionId: "" });
  useNavigationStore.getState().startDraft(null);
  useTimelineStore.setState({
    sessionId: useNavigationStore.getState().sessionId,
    loading: false,
    // A stale per-model entry from the previous session must not leak in.
    modelUsage: {
      "deepseek-flash": { inputTokens: 32_000, contextWindow: 128_000, updatedAt: 1 },
    },
  });
  renderComposer();

  expect(screen.queryByRole("status", { name: "会话用量" })).toBeNull();
  expect(screen.queryByRole("progressbar", { name: "上下文用量" })).toBeNull();
  expect(screen.queryByText(/本轮 0 \//)).toBeNull();
});
