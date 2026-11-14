import { TooltipProvider } from "@larness/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/queries";
import type { ApiSessionDetail } from "@/lib/workspaceApi";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";

const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  updateSession: vi.fn(),
  createSession: vi.fn(),
  createTurn: vi.fn(),
  listModelCatalog: vi.fn(),
}));
vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  ...api,
}));

const deepseek = { model: "deepseek-flash", credentialProfileId: "cred_ds", thinking: "off" };
const glm = { model: "glm-5.3", credentialProfileId: "cred_glm", thinking: "on" };
const deepseekGroup = {
  provider: "deepseek",
  credentialProfileId: deepseek.credentialProfileId,
  credentialLabel: "DeepSeek",
  models: [
    {
      id: deepseek.model,
      label: "DeepSeek Flash",
      contextWindow: 128000,
      thinking: { supported: false, levels: [] },
    },
  ],
};
const glmGroup = {
  provider: "glm",
  credentialProfileId: glm.credentialProfileId,
  credentialLabel: "GLM",
  models: [
    {
      id: glm.model,
      label: "GLM-5.3",
      contextWindow: 200000,
      thinking: { supported: true, mode: "toggle", levels: [] },
    },
  ],
};

function session(id: string): ApiSessionDetail {
  return {
    id,
    projectId: null,
    workspacePath: "/workspace",
    title: "会话",
    status: "active",
    modelProfileId: null,
    approvalPolicyId: "standard",
    createdAt: 1,
    updatedAt: 1,
    lastActivityAt: 1,
    activeTurn: null,
    ...deepseek,
  };
}

const sessions = new Map<string, ApiSessionDetail>();

beforeEach(() => {
  vi.resetAllMocks();
  queryClient.clear();
  sessions.clear();
  useComposerStore.setState({ draft: "" });
  useNavigationStore.getState().selectSession("ses_a", null);
  useTimelineStore.setState({
    sessionId: "ses_a",
    items: [],
    isStreaming: false,
    activeTurnId: null,
  });
  api.listModelCatalog.mockResolvedValue({
    ...deepseekGroup,
    groups: [deepseekGroup, glmGroup],
    defaultSelection: glm,
  });
  api.getSession.mockImplementation(async (id: string) => sessions.get(id) ?? session(id));
  api.updateSession.mockImplementation(async (id: string, patch: Partial<ApiSessionDetail>) => {
    const updated = { ...(sessions.get(id) ?? session(id)), ...patch };
    sessions.set(id, updated);
    return updated;
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

async function selectModel(
  user: ReturnType<typeof userEvent.setup>,
  current: string,
  next: string,
) {
  await user.click(
    await screen.findByRole("button", { name: new RegExp(`模型与思考：${current}`) }),
  );
  await user.click(screen.getByRole("button", { name: `模型：${current}` }));
  await user.click(screen.getByRole("button", { name: new RegExp(next) }));
}

it("saves the model without sending and restores it after changing sessions", async () => {
  const user = userEvent.setup();
  renderComposer();
  await selectModel(user, "DeepSeek Flash", "GLM-5.3");
  await waitFor(() =>
    expect(api.updateSession).toHaveBeenCalledWith("ses_a", { ...glm, thinking: "off" }),
  );
  act(() => useNavigationStore.getState().selectSession("ses_b", null));
  await screen.findByRole("button", { name: /模型与思考：DeepSeek Flash/ });
  act(() => useNavigationStore.getState().selectSession("ses_a", null));
  expect(screen.getByRole("button", { name: /模型与思考：GLM-5.3/ })).toBeVisible();
  expect(api.createTurn).not.toHaveBeenCalled();
});

it("keeps the saved model and displays an error if saving fails", async () => {
  api.updateSession.mockRejectedValueOnce(new Error("request failed"));
  const user = userEvent.setup();
  renderComposer();
  await selectModel(user, "DeepSeek Flash", "GLM-5.3");
  expect(await screen.findByRole("alert")).toHaveTextContent("模型选择保存失败");
  expect(screen.getByRole("button", { name: /模型与思考：DeepSeek Flash/ })).toBeVisible();
});

it("uses the global default for a draft and for its first turn", async () => {
  const user = userEvent.setup();
  useNavigationStore.getState().startDraft(null);
  useTimelineStore.setState({ sessionId: useNavigationStore.getState().sessionId });
  api.createSession.mockResolvedValue({ ...session("ses_new"), ...glm });
  api.createTurn.mockResolvedValue({ turnId: "turn_1" });
  renderComposer();

  expect(await screen.findByRole("button", { name: /模型与思考：GLM-5.3/ })).toBeVisible();
  await user.type(screen.getByRole("textbox", { name: "对话输入" }), "第一条消息");
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() =>
    expect(api.createTurn).toHaveBeenCalledWith(
      "ses_new",
      { input: "第一条消息", ...glm },
      expect.any(String),
    ),
  );
});

it("uses the draft model and approval overrides for the first turn", async () => {
  const user = userEvent.setup();
  useNavigationStore.getState().startDraft(null);
  useTimelineStore.setState({ sessionId: useNavigationStore.getState().sessionId });
  api.createSession.mockResolvedValue({ ...session("ses_new"), ...glm });
  api.createTurn.mockResolvedValue({ turnId: "turn_1" });
  renderComposer();

  await selectModel(user, "GLM-5.3", "DeepSeek Flash");
  await user.click(screen.getByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /只读/ }));
  expect(api.updateSession).not.toHaveBeenCalled();
  await user.type(screen.getByRole("textbox", { name: "对话输入" }), "首条改选消息");
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() =>
    expect(api.createTurn).toHaveBeenCalledWith(
      "ses_new",
      { input: "首条改选消息", ...deepseek },
      expect.any(String),
    ),
  );
  expect(api.updateSession).toHaveBeenCalledWith("ses_new", {
    ...deepseek,
    approvalPolicyId: "readonly",
  });
});

it("persists thinking during an active turn and waits for saving before another send", async () => {
  const user = userEvent.setup();
  sessions.set("ses_a", { ...session("ses_a"), ...glm });
  useTimelineStore.setState({ isStreaming: true, activeTurnId: "turn_running" });
  let finishSave: (value: ApiSessionDetail) => void = () => {};
  api.updateSession.mockImplementationOnce(
    () =>
      new Promise<ApiSessionDetail>((resolve) => {
        finishSave = resolve;
      }),
  );
  renderComposer();

  await user.click(await screen.findByRole("button", { name: "模型与思考：GLM-5.3 · 开启" }));
  await user.click(screen.getByRole("button", { name: "思考等级：开启" }));
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(api.updateSession).toHaveBeenCalledWith("ses_a", { ...glm, thinking: "off" });
  expect(api.createTurn).not.toHaveBeenCalled();
  expect(useTimelineStore.getState().activeTurnId).toBe("turn_running");

  act(() => useTimelineStore.setState({ isStreaming: false, activeTurnId: null }));
  await user.type(screen.getByRole("textbox", { name: "对话输入" }), "下一轮");
  expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await act(async () => finishSave({ ...session("ses_a"), ...glm, thinking: "off" }));
  expect(await screen.findByRole("button", { name: "模型与思考：GLM-5.3 · 关闭" })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled());
});

it("saves approval policy without sending and restores it after a reload", async () => {
  const user = userEvent.setup();
  const view = renderComposer();
  await user.click(await screen.findByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /严格审批/ }));
  await waitFor(() =>
    expect(api.updateSession).toHaveBeenCalledWith("ses_a", { approvalPolicyId: "strict" }),
  );
  expect(api.createTurn).not.toHaveBeenCalled();
  view.unmount();
  queryClient.clear();

  renderComposer();
  expect(await screen.findByRole("button", { name: "审批策略：严格审批" })).toBeVisible();
  act(() => useNavigationStore.getState().selectSession("ses_b", null));
  expect(await screen.findByRole("button", { name: "审批策略：标准审批" })).toBeVisible();
});

it("uses the session's stored approval policy when sending", async () => {
  const user = userEvent.setup();
  sessions.set("ses_a", { ...session("ses_a"), approvalPolicyId: "readonly" });
  api.createTurn.mockResolvedValue({ turnId: "turn_1" });
  renderComposer();
  await user.type(screen.getByRole("textbox", { name: "对话输入" }), "只读检查");
  await user.click(screen.getByRole("button", { name: "发送消息" }));
  await waitFor(() => expect(api.createTurn).toHaveBeenCalled());
  expect(api.updateSession).not.toHaveBeenCalled();
  expect(sessions.get("ses_a")?.approvalPolicyId).toBe("readonly");
});

it("keeps the saved approval policy on a failed change", async () => {
  const user = userEvent.setup();
  sessions.set("ses_a", { ...session("ses_a"), approvalPolicyId: "strict" });
  api.updateSession.mockRejectedValueOnce(new Error("request failed"));
  renderComposer();
  await user.click(await screen.findByRole("button", { name: "审批策略：严格审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /只读/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("审批策略保存失败");
  expect(screen.getByRole("button", { name: "审批策略：严格审批" })).toBeEnabled();
});

it("discards an open autonomous confirmation when changing sessions", async () => {
  const user = userEvent.setup();
  renderComposer();
  await user.click(await screen.findByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /完全自主/ }));
  expect(await screen.findByRole("dialog", { name: "启用完全自主？" })).toBeVisible();
  act(() => useNavigationStore.getState().selectSession("ses_b", null));
  act(() => useNavigationStore.getState().selectSession("ses_a", null));
  expect(screen.queryByRole("dialog", { name: "启用完全自主？" })).toBeNull();
  expect(api.updateSession).not.toHaveBeenCalled();
});

it("writes autonomous only after confirmation and restores it as a session setting", async () => {
  const user = userEvent.setup();
  const view = renderComposer();
  await user.click(await screen.findByRole("button", { name: "审批策略：标准审批" }));
  await user.click(screen.getByRole("menuitemradio", { name: /完全自主/ }));
  expect(api.updateSession).not.toHaveBeenCalled();
  await user.click(await screen.findByRole("button", { name: "确认启用" }));
  await waitFor(() =>
    expect(api.updateSession).toHaveBeenCalledWith("ses_a", { approvalPolicyId: "autonomous" }),
  );
  expect(await screen.findByRole("button", { name: "审批策略：完全自主" })).toBeVisible();
  view.unmount();
  queryClient.clear();
  renderComposer();
  expect(await screen.findByRole("button", { name: "审批策略：完全自主" })).toBeVisible();
  expect(screen.queryByRole("dialog", { name: "启用完全自主？" })).toBeNull();
});
