import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import {
  type ApiCredential,
  type ApiModelCatalog,
  createCredential,
  deleteCredential,
  listCredentials,
  listModelCatalog,
  refreshModelCatalog,
  setModelDefault,
  setModelVisibility,
} from "@/lib/workspaceApi";
import { ModelSettingsDialog } from "./ModelSettingsDialog";

vi.mock("@/lib/workspaceApi", () => ({
  createCredential: vi.fn(),
  deleteCredential: vi.fn(),
  listCredentials: vi.fn(),
  listModelCatalog: vi.fn(),
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
      <ModelSettingsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("还没有 Key。添加后即可同步官方模型目录。");
  fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
  fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "placeholder" } });
  fireEvent.click(screen.getByRole("button", { name: "添加" }));
  return invalidateQueries;
}

it("selects a GLM endpoint through the shared dropdown", async () => {
  const user = userEvent.setup();
  vi.mocked(refreshModelCatalog).mockResolvedValue({ ...synced, groups: [synced] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ModelSettingsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("还没有 Key。添加后即可同步官方模型目录。");
  await user.click(screen.getByRole("button", { name: "添加 Key" }));
  await user.click(screen.getByRole("button", { name: "GLM" }));
  await user.click(screen.getByRole("button", { name: "GLM 端点" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Coding Plan · 国际" }));
  await user.type(screen.getByLabelText("API Key"), "placeholder");
  await user.click(screen.getByRole("button", { name: "添加" }));

  expect(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ })).toBeVisible();
  expect(createCredential).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "glm", endpoint: "https://api.z.ai/api/coding/paas/v4" }),
  );
});

it("synchronizes the official catalog after saving a Key", async () => {
  vi.mocked(refreshModelCatalog).mockResolvedValue({ ...synced, groups: [synced] });
  const invalidateQueries = await addKey();

  expect(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ })).toBeVisible();
  expect(refreshModelCatalog).toHaveBeenCalledTimes(1);
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
      <ModelSettingsDialog open onOpenChange={vi.fn()} />
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
      <ModelSettingsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole("button", { name: /测试凭据.*1 个模型/ }));
  const model = screen.getByRole("button", { name: /^测试模型 默认/ });
  expect(model).toBeEnabled();

  await user.click(screen.getByRole("button", { name: "测试模型 在会话中显示" }));
  expect(setModelVisibility).toHaveBeenCalledWith({
    credentialProfileId: credential.id,
    modelId: "test-model",
    visible: false,
  });
  await waitFor(() => expect(model).not.toHaveTextContent("默认"));
  expect(model).toBeDisabled();
  await user.click(model);
  expect(setModelDefault).not.toHaveBeenCalled();
});
