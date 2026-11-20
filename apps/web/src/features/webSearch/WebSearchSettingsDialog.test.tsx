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
      connections: [
        {
          id: "wsc_1",
          provider: "deepseek" as const,
          label: "DeepSeek 搜索",
          region: null,
          endpoint: "https://api.deepseek.com",
          maskedKey: "••••••",
          createdAt: 1,
        },
      ],
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
  vi.mocked(createWebSearchConnection).mockResolvedValue({
    id: "wsc_1",
    provider: "deepseek",
    label: "DeepSeek 搜索",
    region: null,
    endpoint: "https://api.deepseek.com",
    maskedKey: "••••••",
    createdAt: 1,
  });
});

it("adds a DeepSeek search connection without exposing the key in the list", async () => {
  renderDialog();

  expect(await screen.findByText("还没有搜索连接")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "添加搜索连接" }));
  fireEvent.change(screen.getByPlaceholderText("例如：DeepSeek 搜索"), {
    target: { value: "DeepSeek 搜索" },
  });
  fireEvent.change(screen.getByPlaceholderText("sk-…"), {
    target: { value: "sk-search-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

  await waitFor(() =>
    expect(createWebSearchConnection).toHaveBeenCalledWith({
      provider: "deepseek",
      label: "DeepSeek 搜索",
      apiKey: "sk-search-secret",
    }),
  );
  expect(screen.queryByText("sk-search-secret")).not.toBeInTheDocument();
});

it("shows the active connection and tests or deletes it", async () => {
  vi.mocked(useWebSearchSettings).mockReturnValue(configuredSettings());
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
    connections: [],
  });
  renderDialog();

  fireEvent.click(await screen.findByRole("button", { name: "选择连接：DeepSeek 搜索" }));
  fireEvent.click(screen.getByRole("button", { name: /测试连接/ }));
  await waitFor(() => expect(screen.getByText("连接可用：1 条结果，42 ms")).toBeInTheDocument());

  fireEvent.click(screen.getByRole("button", { name: /删除/ }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  await waitFor(() => expect(deleteWebSearchConnection).toHaveBeenCalledWith("wsc_1"));
});
