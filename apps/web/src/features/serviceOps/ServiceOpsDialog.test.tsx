import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { controlFormalService, listFormalServices } from "./api";
import { ServiceOpsDialog } from "./ServiceOpsDialog";

vi.mock("./api", () => ({
  serviceOpsServicesKey: ["service-ops", "services"],
  serviceOpsDeploymentsKey: (id: string) => ["service-ops", "deployments", id],
  serviceOpsLogsKey: (id: string) => ["service-ops", "logs", id],
  listFormalServices: vi.fn(async () => ({
    items: [
      {
        targetId: "tgt_00000000-0000-4000-8000-000000000001",
        projectId: "prj_one",
        projectName: "示例项目",
        name: "api",
        pm2Name: "larness:prj_one:api",
        source: "pm2-cli",
        version: null,
        artifactHash: null,
        desiredState: "running",
        observedState: "running",
        pid: 1234,
        lastHealthAt: null,
        reasonCode: "HEALTH_UNVERIFIED",
        updatedAt: Date.now(),
      },
    ],
    unassociated: [],
    pm2Home: "/runtime/larness/pm2",
  })),
  listFormalDeployments: vi.fn(async () => []),
  readFormalLogs: vi.fn(async () => ({ text: "ready", cursor: 5, truncated: false })),
  controlFormalService: vi.fn(async () => ({})),
}));
beforeEach(() => {
  vi.clearAllMocks();
  useComposerStore.setState({ draft: "" });
  useNavigationStore.setState({ projectId: null, sessionId: "", draftSession: null });
});

it("starts a stopped service directly and returns to the list", async () => {
  const data = await listFormalServices();
  vi.mocked(listFormalServices).mockResolvedValueOnce({
    ...data,
    items: data.items.map((service) => ({
      ...service,
      observedState: "stopped",
      desiredState: "stopped",
      pid: null,
      reasonCode: null,
    })),
  });
  const service = data.items[0];
  if (!service) throw new Error("missing service fixture");
  vi.mocked(controlFormalService).mockResolvedValueOnce(service);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServiceOpsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /api.*已停止/ }));
  expect(screen.getByRole("button", { name: "停止" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "启动" }));
  await waitFor(() => expect(controlFormalService).toHaveBeenCalledOnce());
  expect(controlFormalService).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ action: "start", confirmed: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "返回服务列表" }));
  expect(await screen.findByRole("button", { name: /api.*运行中/ })).toBeVisible();
});
it("shows the PM2 project association and opens the ordinary project conversation", async () => {
  const closed = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServiceOpsDialog open onOpenChange={closed} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("larness:prj_one:api")).toBeVisible();
  expect(screen.queryByText(/独立于当前聊/)).not.toBeInTheDocument();
  expect(screen.getByText("本机 PM2 查询命令")).toBeVisible();
  expect(screen.getByText("PM2_HOME='/runtime/larness/pm2' pm2 list")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /api.*运行中/ }));
  expect(screen.getByText("所属项目 示例项目")).toBeVisible();
  expect(await screen.findByText("ready")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "在项目会话中处理" }));
  expect(useNavigationStore.getState().projectId).toBe("prj_one");
  expect(useComposerStore.getState().draft).toContain("larness:prj_one:api");
  expect(closed).toHaveBeenCalledWith(false);
});

it("requires stop confirmation, cancels without a request and reports control failures", async () => {
  vi.mocked(controlFormalService).mockRejectedValueOnce(new Error("unavailable"));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServiceOpsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /api.*运行中/ }));
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(screen.getByRole("heading", { name: "停止服务？" })).toBeVisible();
  expect(controlFormalService).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(controlFormalService).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  fireEvent.click(screen.getByRole("button", { name: "确认停止" }));
  await waitFor(() => expect(controlFormalService).toHaveBeenCalledOnce());
  expect(vi.mocked(controlFormalService).mock.calls[0]).toEqual([
    "tgt_00000000-0000-4000-8000-000000000001",
    expect.objectContaining({
      action: "stop",
      expectedPm2Name: "larness:prj_one:api",
      confirmed: true,
      requestKey: expect.any(String),
    }),
  ]);
  expect(await screen.findByRole("alert")).toHaveTextContent("操作失败");
});

it("returns to the empty list and closes pending confirmation when the selected service is deleted", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ServiceOpsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /api.*运行中/ }));
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  expect(screen.getByRole("heading", { name: "停止服务？" })).toBeVisible();
  vi.mocked(listFormalServices).mockResolvedValueOnce({
    items: [],
    unassociated: [],
    pm2Home: "/runtime/larness/pm2",
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["service-ops", "services"] });
  });
  expect(await screen.findByText("暂无正式服务")).toBeVisible();
  expect(screen.queryByRole("heading", { name: "停止服务？" })).not.toBeInTheDocument();
  expect(controlFormalService).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("服务详情")).not.toBeInTheDocument();
});
