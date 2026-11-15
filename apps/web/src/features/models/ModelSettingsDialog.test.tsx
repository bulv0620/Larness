import { TooltipProvider } from "@larness/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  type ApiCredential,
  type ApiModelCatalog,
  createCredential,
  deleteCredential,
  listCredentials,
  listModelCatalog,
  listModelPresets,
  refreshModelCatalog,
  setModelDefault,
  setModelVisibility,
  testModelConnection,
} from "@/lib/workspaceApi";
import { ModelSettingsDialog } from "./ModelSettingsDialog";

vi.mock("@/lib/workspaceApi", () => ({
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  listCredentials: vi.fn(),
  listModelCatalog: vi.fn(),
  listModelPresets: vi.fn(),
  setCapabilityOverride: vi.fn(),
  updateCredentialSettings: vi.fn(),
  testModelConnection: vi.fn(),
  refreshModelCatalog: vi.fn(),
  setModelDefault: vi.fn(),
  setModelVisibility: vi.fn(),
}));

const credential: ApiCredential = {
  id: "credential_test",
  label: "测试凭据",
  provider: "deepseek",
  masked: "••••",
  secretRef: "secret_test",
  createdAt: 1,
};

const group = {
  credentialProfileId: credential.id,
  credentialLabel: credential.label,
  provider: credential.provider,
  syncedAt: null,
  stale: true,
  lastRefreshError: null,
  models: [],
};

const synced = {
  ...group,
  syncedAt: 1,
  stale: false,
  models: [
    {
      id: "test-model",
      label: "测试模型",
      contextWindow: 128_000,
      default: false,
      thinking: { supported: false, levels: [] },
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listModelPresets).mockResolvedValue([
    {
      id: "deepseek-api",
      provider: "deepseek",
      label: "DeepSeek",
      endpoint: null,
      billing: "usage",
    },
    {
      id: "glm-standard-cn",
      provider: "glm",
      label: "智谱国内 · 标准 API",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
      billing: "usage",
    },
    {
      id: "glm-coding-intl",
      provider: "glm",
      label: "Z.AI · Coding Plan",
      endpoint: "https://api.z.ai/api/coding/paas/v4",
      billing: "subscription",
    },
  ]);
  vi.mocked(createCredential).mockResolvedValue(credential);
  vi.mocked(listCredentials).mockResolvedValueOnce([]).mockResolvedValue([credential]);
  vi.mocked(listModelCatalog)
    .mockResolvedValueOnce({ ...group, groups: [] })
    .mockResolvedValue({ ...group, groups: [group] });
});

async function addKey() {
  const client = new QueryClient();
  const invalidateQueries = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("还没有 Key。添加后即可同步官方模型目录。");
  fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
  const dialog = screen.getByRole("dialog", { name: "添加 Key" });
  fireEvent.change(within(dialog).getByLabelText("API Key"), { target: { value: "placeholder" } });
  fireEvent.click(within(dialog).getByRole("button", { name: /^添加$/ }));
  return invalidateQueries;
}

it("selects a GLM endpoint through the shared dropdown", async () => {
  const user = userEvent.setup();
  vi.mocked(refreshModelCatalog).mockResolvedValue({ ...synced, groups: [synced] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("还没有 Key。添加后即可同步官方模型目录。");
  await user.click(screen.getByRole("button", { name: "添加 Key" }));
  await user.click(screen.getByRole("button", { name: "GLM" }));
  await user.click(screen.getByRole("button", { name: "Key 来源" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Z.AI · Coding Plan" }));
  await user.type(screen.getByLabelText("API Key"), "placeholder");
  await user.click(screen.getByRole("button", { name: "添加" }));

  expect(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ })).toBeVisible();
  expect(createCredential).toHaveBeenCalledWith(
    expect.objectContaining({ presetId: "glm-coding-intl" }),
  );
});

it("synchronizes the official catalog after saving a Key", async () => {
  vi.mocked(refreshModelCatalog).mockResolvedValue({ ...synced, groups: [synced] });
  const invalidateQueries = await addKey();

  expect(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ })).toBeVisible();
  expect(refreshModelCatalog).toHaveBeenCalledWith({ credentialProfileId: credential.id });
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["model-catalog"] });
});

it.each([
  {
    ...group,
    lastRefreshError: "PROVIDER_AUTH_FAILED",
  } satisfies ApiModelCatalog["groups"][number],
  null,
])("keeps the saved Key available when catalog synchronization fails (%j)", async (failed) => {
  if (failed) {
    vi.mocked(refreshModelCatalog).mockResolvedValue({ ...failed, groups: [failed] });
  } else {
    vi.mocked(refreshModelCatalog).mockRejectedValue(new Error("unavailable"));
  }
  await addKey();

  expect(await screen.findByRole("alert")).toHaveTextContent("Key 已保存，目录同步失败");
  expect(screen.getByRole("button", { name: /测试凭据/ })).toBeVisible();
  expect(createCredential).toHaveBeenCalledTimes(1);
});

it("does not synchronize when saving the Key fails", async () => {
  vi.mocked(createCredential).mockRejectedValue(new Error("保存 Key 失败"));
  await addKey();

  expect(await screen.findByRole("alert")).toHaveTextContent("保存 Key 失败");
  expect(refreshModelCatalog).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "添加" })).toBeEnabled();
});

it("asks for confirmation before deleting a Key", async () => {
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential]);
  vi.mocked(listModelCatalog)
    .mockReset()
    .mockResolvedValue({ ...synced, groups: [synced] });
  vi.mocked(deleteCredential).mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /测试凭据/ }));
  fireEvent.click(screen.getByRole("button", { name: "删除 Key" }));

  expect(screen.getByText("删除 Key？")).toBeVisible();
  // 回归：确认弹窗的遮罩/内容层级必须高于外层弹窗内容（z-[301]），否则遮罩盖不住外层弹窗。
  const confirmDialog = screen.getByText("删除 Key？").closest('[role="dialog"]');
  expect(confirmDialog).toHaveClass("z-[311]");
  const confirmOverlay = confirmDialog?.previousElementSibling;
  expect(confirmOverlay).toHaveClass("z-[310]");
  const outerDialog = screen
    .getAllByRole("dialog", { hidden: true })
    .find((dialog) => dialog !== confirmDialog);
  expect(outerDialog).toHaveClass("z-[301]");
  expect(deleteCredential).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() => expect(screen.queryByText("删除 Key？")).toBeNull());
  expect(deleteCredential).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "删除 Key" }));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));

  await waitFor(() => expect(deleteCredential).toHaveBeenCalledWith("credential_test"));
});

it("removes the default marker and disables setting a model as default after hiding it", async () => {
  const user = userEvent.setup();
  const visible = {
    ...synced,
    groups: [synced],
    defaultSelection: { model: "test-model", credentialProfileId: credential.id, thinking: "off" },
  };
  const hidden = {
    ...synced,
    models: synced.models.map((model) => ({ ...model, visible: false })),
  };
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential]);
  vi.mocked(listModelCatalog)
    .mockReset()
    .mockResolvedValueOnce(visible)
    .mockResolvedValue({
      ...hidden,
      groups: [hidden],
      defaultSelection: null,
    });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ }));
  const model = screen.getByRole("button", { name: "测试模型" });
  expect(screen.getByLabelText("新会话默认模型")).toBeVisible();
  expect(screen.queryByRole("button", { name: "设为默认" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "测试模型 在会话中显示" }));
  expect(setModelVisibility).toHaveBeenCalledWith({
    credentialProfileId: credential.id,
    modelId: "test-model",
    visible: false,
  });
  await waitFor(() => expect(screen.queryByLabelText("新会话默认模型")).toBeNull());
  expect(screen.queryByText("已隐藏")).toBeNull();
  fireEvent.contextMenu(model);
  const setDefault = await screen.findByRole("menuitem", { name: "设为默认" });
  expect(setDefault).toHaveAttribute("aria-disabled", "true");
  await user.click(setDefault);
  expect(setModelDefault).not.toHaveBeenCalled();
});

it("displays capabilities and actions inside the selected Key, with identical model IDs kept separate", async () => {
  const other = {
    ...credential,
    id: "credential_other",
    label: "套餐 Key",
    billing: "subscription",
  } as const;
  const imageModel = {
    ...synced.models[0],
    contextWindow: 128_000,
    capabilities: { inputModalities: ["text", "image"], tools: true },
  };
  const primary = { ...synced, models: [imageModel] };
  const secondary = {
    ...synced,
    credentialProfileId: other.id,
    credentialLabel: other.label,
    models: [
      {
        ...imageModel,
        capabilities: { inputModalities: ["text"], tools: false },
        agentSelectable: false,
      },
    ],
  };
  const catalog = { ...primary, groups: [primary, secondary] };
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential, other]);
  vi.mocked(listModelCatalog).mockReset().mockResolvedValue(catalog);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const panel = await screen.findByRole("region", { name: "测试凭据 模型" });
  expect(within(panel).getByLabelText(/支持截图.*支持工具/)).toBeVisible();
  expect(within(panel).getByText("128K")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /套餐 Key.*套餐额度/ }));
  const secondPanel = screen.getByRole("region", { name: "套餐 Key 模型" });
  expect(within(secondPanel).queryByLabelText(/^支持截图/)).toBeNull();
  expect(within(secondPanel).getByText("不支持工具")).toBeVisible();
  await user.click(within(secondPanel).getByRole("button", { name: "测试模型 在会话中显示" }));
  expect(setModelVisibility).toHaveBeenCalledWith({
    credentialProfileId: other.id,
    modelId: "test-model",
    visible: false,
  });
});

it("keeps saved Keys selectable when the catalog is unavailable", async () => {
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential]);
  vi.mocked(listModelCatalog).mockReset().mockRejectedValue(new Error("unavailable"));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: /测试凭据/ })).toBeVisible();
  expect(screen.getByText("目录不可用，请刷新。")).toBeVisible();
  expect(screen.getByRole("button", { name: "刷新目录" })).toBeEnabled();
});

it("places the compatible platform after official platforms", async () => {
  vi.mocked(listModelPresets).mockResolvedValue([
    {
      id: "compatible",
      provider: "openai-compatible",
      label: "兼容",
      endpoint: null,
      billing: "unknown",
    },
    {
      id: "deepseek-api",
      provider: "deepseek",
      label: "DeepSeek",
      endpoint: null,
      billing: "usage",
    },
    {
      id: "opencode-go",
      provider: "opencode-go",
      label: "OpenCode Go",
      endpoint: null,
      billing: "subscription",
    },
  ]);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByText("还没有 Key。添加后即可同步官方模型目录。");
  await user.click(screen.getByRole("button", { name: "添加 Key" }));
  expect(screen.getAllByRole("button", { name: /^(DeepSeek|OpenCode Go|兼容)$/ })).toEqual([
    screen.getByRole("button", { name: "DeepSeek" }),
    screen.getByRole("button", { name: "OpenCode Go" }),
    screen.getByRole("button", { name: "兼容" }),
  ]);
});

it("shows pending feedback for the model under test, then clears it on failure", async () => {
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential]);
  vi.mocked(listModelCatalog)
    .mockReset()
    .mockResolvedValue({ ...synced, groups: [synced] });
  let rejectAttempt: (error: Error) => void = () => {};
  vi.mocked(testModelConnection).mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectAttempt = reject;
      }),
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  const model = await screen.findByRole("button", { name: "测试模型" });
  expect(screen.queryByRole("button", { name: "测试调用" })).toBeNull();
  model.focus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  await user.click(await screen.findByRole("menuitem", { name: "测试调用" }));
  expect(testModelConnection).toHaveBeenCalledWith(credential.id, "test-model");
  expect(screen.getByRole("status")).toHaveTextContent("测试中");
  rejectAttempt(new Error("unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent("测试调用失败");
  expect(screen.queryByText("测试中…")).toBeNull();
});

it("shows visible capability labels and keeps Key editing inside separate dialogs", async () => {
  vi.mocked(listCredentials).mockReset().mockResolvedValue([credential]);
  vi.mocked(listModelCatalog)
    .mockReset()
    .mockResolvedValue({ ...synced, groups: [synced] });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ModelSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  fireEvent.contextMenu(await screen.findByRole("button", { name: "测试模型" }));
  await user.click(screen.getByRole("menuitem", { name: "详情" }));
  const details = screen.getByRole("dialog", { name: "模型能力" });
  for (const label of ["工具调用", "截图输入", "思考模式"]) {
    expect(within(details).getByText(label, { exact: true })).toBeVisible();
  }
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "管理 Key" }));
  const manage = screen.getByRole("dialog", { name: "管理 Key" });
  await user.type(within(manage).getByLabelText("替换 API Key"), "placeholder");
  await user.click(within(manage).getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "管理 Key" }));
  expect(
    within(screen.getByRole("dialog", { name: "管理 Key" })).getByLabelText("替换 API Key"),
  ).toHaveValue("");
});
