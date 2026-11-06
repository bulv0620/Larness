import type { ServiceActionView, ServiceDto } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { ServiceWindow } from "./ServiceWindow";

vi.mock("@/features/services/api", async (original) => ({
  ...(await original<typeof import("@/features/services/api")>()),
  listServices: vi.fn(),
  readService: vi.fn(),
  readServiceLogs: vi.fn(),
  createServiceAction: vi.fn(),
  decideServiceAction: vi.fn(),
  executeServiceAction: vi.fn(),
  stopService: vi.fn(),
  deleteService: vi.fn(),
}));
vi.mock("@/features/terminals/api", async (original) => ({
  ...(await original<typeof import("@/features/terminals/api")>()),
  readTerminal: vi.fn(),
  openTerminal: vi.fn(),
  listTerminals: vi.fn(),
}));

const {
  listServices,
  readService,
  readServiceLogs,
  createServiceAction,
  decideServiceAction,
  executeServiceAction,
  stopService,
  deleteService,
} = await import("@/features/services/api");
const { readTerminal, openTerminal, listTerminals } = await import("@/features/terminals/api");

const terminalId = "term_00000000-0000-0000-0000-000000000001";
const serviceId = "svc_00000000-0000-0000-0000-000000000001";
const service: ServiceDto = {
  id: serviceId,
  projectId: "prj_1",
  sourceSessionId: null,
  name: "web",
  kind: "temporary",
  status: "RUNNING",
  terminalId,
  terminalExecutionId: "exe_00000000-0000-0000-0000-000000000001",
  endpointGeneration: 1,
  endpoint: { host: "127.0.0.1", port: 5173, protocol: "http" },
  previewEligible: true,
  reasonCode: null,
  createdAt: 1,
  updatedAt: 1,
  endedAt: null,
};
const tab = {
  id: "tab-services",
  kind: "services" as const,
  resourceId: "services:empty",
  title: "服务",
  projectId: "prj_1",
  sourceSessionId: null,
  originType: "project" as const,
};

function renderWindow(value = tab) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ServiceWindow tab={value} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listServices).mockResolvedValue([service]);
  vi.mocked(readService).mockResolvedValue(service);
  vi.mocked(readServiceLogs).mockResolvedValue({
    terminalId,
    chunks: [{ cursor: 1, data: "ready\n", timestamp: 1 }],
    nextCursor: 1,
    truncated: false,
    resyncRequired: false,
  });
  vi.mocked(listTerminals).mockResolvedValue({ items: [], nextCursor: null } as never);
});

it("shows registered service cards, detail, terminal output and opens the owning terminal", async () => {
  vi.mocked(readTerminal).mockResolvedValue({ id: terminalId } as never);
  renderWindow();
  fireEvent.click(await screen.findByRole("button", { name: /web/ }));
  expect(await screen.findByText("http://127.0.0.1:5173")).toBeTruthy();
  expect(await screen.findByText("ready")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "打开终端" }));
  await waitFor(() => expect(readTerminal).toHaveBeenCalledWith(terminalId));
  await waitFor(() => expect(openTerminal).toHaveBeenCalled());
});

it("registers through the resource action and shows the new detail after approval", async () => {
  vi.mocked(listServices).mockResolvedValue([]);
  vi.mocked(listTerminals).mockResolvedValue({
    items: [{ id: terminalId, status: "RUNNING", title: "dev", role: "frontend" }],
    nextCursor: null,
  } as never);
  const pending: ServiceActionView = {
    id: "act_1",
    projectId: "prj_1",
    kind: "service.register",
    risk: "L2",
    status: "WAITING_APPROVAL",
    params: {
      kind: "temporary",
      terminalId,
      name: "web",
      endpoint: { host: "127.0.0.1", port: 5173, protocol: "http" },
    },
    paramsHash: "h",
    snapshotVersion: "s",
    requestedBy: "c",
    decidedBy: null,
    expiresAt: 2,
    decidedAt: null,
    startedAt: null,
    endedAt: null,
    result: null,
    createdAt: 1,
  };
  vi.mocked(createServiceAction).mockResolvedValue(pending);
  vi.mocked(decideServiceAction).mockResolvedValue({ ...pending, status: "APPROVED" });
  vi.mocked(executeServiceAction).mockResolvedValue({
    ...pending,
    status: "COMPLETED",
    result: { serviceId },
  });
  renderWindow({ ...tab, id: "tab-services-2" });
  expect(await screen.findByText(/实际监听端口登记/)).toBeTruthy();
  const [register] = await screen.findAllByRole("button", { name: "登记服务" });
  fireEvent.click(register);
  await screen.findByText("登记临时服务");
  expect(screen.getByText(/选择当前项目.*服务的监听端口/)).toBeTruthy();
  expect(screen.getByText(/0\.0\.0\.0.*可登记/)).toBeTruthy();
  await screen.findByRole("option", { name: /dev/ });
  fireEvent.change(screen.getByLabelText("选择终端"), { target: { value: terminalId } });
  fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "web" } });
  fireEvent.change(screen.getByLabelText("服务端口"), { target: { value: "5173" } });
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "批准并登记" }));
  await waitFor(() => expect(executeServiceAction).toHaveBeenCalledWith("act_1"));
  expect(await screen.findByText("运行中")).toBeTruthy();
});

it("returns to the form when execution fails terminally instead of leaving a dead approval", async () => {
  vi.mocked(listServices).mockResolvedValue([]);
  vi.mocked(listTerminals).mockResolvedValue({
    items: [{ id: terminalId, status: "RUNNING", title: "dev", role: "backend" }],
    nextCursor: null,
  } as never);
  const pending: ServiceActionView = {
    id: "act_failed",
    projectId: "prj_1",
    kind: "service.register",
    risk: "L2",
    status: "WAITING_APPROVAL",
    params: {
      kind: "temporary",
      terminalId,
      name: "web",
      endpoint: { host: "127.0.0.1", port: 5173, protocol: "http" },
    },
    paramsHash: "h",
    snapshotVersion: "s",
    requestedBy: "c",
    decidedBy: null,
    expiresAt: 2,
    decidedAt: null,
    startedAt: null,
    endedAt: null,
    result: null,
    createdAt: 1,
  };
  vi.mocked(createServiceAction).mockResolvedValue(pending);
  vi.mocked(decideServiceAction).mockResolvedValue({ ...pending, status: "APPROVED" });
  vi.mocked(executeServiceAction).mockRejectedValue(
    new ApiError(403, "PREVIEW_TARGET_INVALID", "Listener does not belong to this terminal"),
  );
  renderWindow({ ...tab, id: "tab-services-fail" });
  const [register] = await screen.findAllByRole("button", { name: "登记服务" });
  fireEvent.click(register);
  await screen.findByText("登记临时服务");
  await screen.findByRole("option", { name: /dev/ });
  fireEvent.change(screen.getByLabelText("选择终端"), { target: { value: terminalId } });
  fireEvent.change(screen.getByLabelText("服务名称"), { target: { value: "web" } });
  fireEvent.change(screen.getByLabelText("服务端口"), { target: { value: "5173" } });
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  fireEvent.click(await screen.findByRole("button", { name: "批准并登记" }));

  expect(await screen.findByText(/没有可核验、且属于此终端的监听/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "批准并登记" })).toBeNull();
  expect(screen.getByLabelText("服务名称")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
  await waitFor(() => expect(createServiceAction).toHaveBeenCalledTimes(2));
});

it("stops the verified service process only after confirmation", async () => {
  vi.mocked(stopService).mockResolvedValue({
    ...service,
    status: "UNREGISTERED",
    reasonCode: "STOPPED_BY_USER",
  });
  renderWindow({ ...tab, id: "tab-stop" });
  fireEvent.click(await screen.findByRole("button", { name: /web/ }));
  await screen.findByText("http://127.0.0.1:5173");
  fireEvent.click(screen.getByRole("button", { name: "停止服务" }));
  expect(await screen.findByText("停止服务？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "停止" }));
  await waitFor(() => expect(stopService).toHaveBeenCalledWith(serviceId));
  await waitFor(() => expect(screen.queryByText("停止服务？")).toBeNull());
});

it("deletes a registration without claiming to stop the process", async () => {
  vi.mocked(deleteService).mockResolvedValue({
    ...service,
    status: "UNREGISTERED",
    reasonCode: "DELETED",
  });
  renderWindow({ ...tab, id: "tab-delete" });
  fireEvent.click(await screen.findByRole("button", { name: /web/ }));
  await screen.findByText("http://127.0.0.1:5173");
  fireEvent.click(screen.getByRole("button", { name: "删除登记" }));
  expect(await screen.findByText("删除登记？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  await waitFor(() => expect(deleteService).toHaveBeenCalledWith(serviceId));
});
