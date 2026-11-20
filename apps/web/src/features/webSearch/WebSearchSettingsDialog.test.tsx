import { TooltipProvider } from "@larness/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useWebSearchSettings } from "@/lib/queries";
import {
  createWebSearchConnection,
  deleteWebSearchConnection,
  saveWebSearchSettings,
  testWebSearchConnection,
  updateWebSearchConnection,
} from "@/lib/workspaceApi";
import { WebSearchSettingsDialog } from "./WebSearchSettingsDialog";

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  return { ...actual, useWebSearchSettings: vi.fn() };
});

vi.mock("@/lib/workspaceApi", () => ({
  createWebSearchConnection: vi.fn(),
  deleteWebSearchConnection: vi.fn(),
  saveWebSearchSettings: vi.fn(),
  testWebSearchConnection: vi.fn(),
  updateWebSearchConnection: vi.fn(),
}));

const connection = {
  id: "wsc_1",
  provider: "deepseek" as const,
  label: "DeepSeek 搜索",
  region: null,
  endpoint: "https://api.deepseek.com",
  maskedKey: "••••••",
  createdAt: 1,
};

function emptySettings() {
  return {
    data: {
      activeConnectionId: null,
      maxResults: 5,
      maxSearchesPerTurn: 6,
      maxFetchesPerTurn: 4,
      connections: [],
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  };
}

function configuredSettings() {
  return {
    ...emptySettings(),
    data: {
      activeConnectionId: "wsc_1",
      maxResults: 5,
      maxSearchesPerTurn: 6,
      maxFetchesPerTurn: 4,
      connections: [connection],
    },
  };
}

function renderDialog() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <WebSearchSettingsDialog open onOpenChange={vi.fn()} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useWebSearchSettings).mockReturnValue(emptySettings());
  vi.mocked(createWebSearchConnection).mockResolvedValue(connection);
  vi.mocked(updateWebSearchConnection).mockResolvedValue({ ...connection, label: "Edited" });
  vi.mocked(testWebSearchConnection).mockResolvedValue({
    ok: true,
    latencyMs: 42,
    resultCount: 1,
  });
  vi.mocked(deleteWebSearchConnection).mockResolvedValue(undefined);
  vi.mocked(saveWebSearchSettings).mockResolvedValue({
    activeConnectionId: "wsc_1",
    maxResults: 5,
    maxSearchesPerTurn: 6,
    maxFetchesPerTurn: 4,
    connections: [connection],
  });
});

it("adds a DeepSeek search key from the header without exposing it in the list", async () => {
  renderDialog();

  expect(await screen.findByText("还没有搜索 Key")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "添加 Key" }));
  fireEvent.change(screen.getByPlaceholderText("例如：DeepSeek 搜索"), {
    target: { value: "DeepSeek 搜索" },
  });
  fireEvent.change(screen.getByPlaceholderText("sk-…"), {
    target: { value: "sk-search-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() =>
    expect(createWebSearchConnection).toHaveBeenCalledWith({
      provider: "deepseek",
      label: "DeepSeek 搜索",
      apiKey: "sk-search-secret",
    }),
  );
  expect(screen.queryByText("sk-search-secret")).not.toBeInTheDocument();
});

it("keeps key actions in the list, shows test loading, and deletes with confirmation", async () => {
  vi.mocked(useWebSearchSettings).mockReturnValue(configuredSettings());
  let resolveTest: (value: { ok: boolean; latencyMs: number; resultCount: number }) => void = () =>
    undefined;
  vi.mocked(testWebSearchConnection).mockReturnValue(
    new Promise((resolve) => {
      resolveTest = resolve;
    }),
  );
  renderDialog();

  const testButton = await screen.findByRole("button", { name: "测试连接 DeepSeek 搜索" });
  fireEvent.click(testButton);
  expect(testButton).toHaveAttribute("aria-busy", "true");
  resolveTest({ ok: true, latencyMs: 42, resultCount: 1 });
  const testResult = await screen.findByRole("status");
  expect(testResult).toHaveTextContent("「DeepSeek 搜索」连接可用：1 条结果 · 42 ms");
  expect(testButton).toHaveAttribute("aria-busy", "false");

  fireEvent.click(screen.getByRole("button", { name: "删除 DeepSeek 搜索" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(deleteWebSearchConnection).toHaveBeenCalledWith("wsc_1"));
});

it("edits a key and saves every-round quotas in separate dialogs", async () => {
  vi.mocked(useWebSearchSettings).mockReturnValue(configuredSettings());
  renderDialog();

  fireEvent.click(await screen.findByRole("button", { name: "编辑 DeepSeek 搜索" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Edited" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(updateWebSearchConnection).toHaveBeenCalledWith("wsc_1", { label: "Edited" }),
  );
  const updated = await screen.findByRole("status");
  expect(updated).toHaveTextContent("搜索 Key 已更新");

  fireEvent.click(screen.getByRole("button", { name: "每轮配额" }));
  fireEvent.change(screen.getByLabelText("每轮搜索次数"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("每轮抓取次数"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(saveWebSearchSettings).toHaveBeenCalledWith({
      activeConnectionId: "wsc_1",
      maxResults: 5,
      maxSearchesPerTurn: 3,
      maxFetchesPerTurn: 2,
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent("每轮配额已保存");
});
