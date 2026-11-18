import type { ProcessDto } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useWindowStore } from "@/stores/windowStore";
import { ServiceWindow } from "./ServiceWindow";

vi.mock("@/lib/env", () => ({ USE_MOCKS: false }));
vi.mock("@/features/processes/api", async (original) => ({
  ...(await original<typeof import("@/features/processes/api")>()),
  listProcesses: vi.fn(),
  readProcess: vi.fn(),
  readProcessOutput: vi.fn(),
  stopProcess: vi.fn(),
}));

const { listProcesses, readProcess, readProcessOutput, stopProcess } = await import(
  "@/features/processes/api"
);

const processId = "prc_00000000-0000-4000-8000-000000000001";
const process: ProcessDto = {
  id: processId,
  projectId: "prj_1",
  sessionId: "ses_1",
  name: "web",
  status: "RUNNING",
  executable: "pnpm",
  cwd: "/tmp/project",
  pid: 4321,
  exitCode: null,
  reasonCode: null,
  startedAt: 1,
  endedAt: null,
  port: 5173,
  healthPath: "/",
  previewEligible: true,
  outputCursor: 1,
  truncated: false,
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

function renderWindow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ServiceWindow tab={tab} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  useWindowStore.setState({ windows: [], focusedId: null, zCounter: 10 });
  vi.mocked(listProcesses).mockResolvedValue([process]);
  vi.mocked(readProcess).mockResolvedValue(process);
  vi.mocked(readProcessOutput).mockResolvedValue({
    chunks: [{ cursor: 1, data: "ready\n", channel: "stdout", timestamp: 1 }],
    nextCursor: 1,
    oldestCursor: 1,
    truncated: false,
    resyncRequired: false,
  });
  vi.mocked(stopProcess).mockResolvedValue({} as never);
});

it("lists real background processes with port, PID and logs", async () => {
  const { container } = renderWindow();
  expect(await screen.findByText("web")).toBeTruthy();
  expect(screen.getByText("127.0.0.1:5173")).toBeTruthy();
  expect(screen.getByText(/PID 4321/)).toBeTruthy();
  expect(screen.getByText("可预览")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /web/ }));
  expect(await screen.findByText("127.0.0.1:5173")).toBeTruthy();
  await waitFor(() => expect(container.querySelector("[role=log]")?.textContent).toBe("ready\n"));
});

it("opens a process preview tab only after the user clicks preview", async () => {
  renderWindow();
  fireEvent.click(await screen.findByRole("button", { name: /web/ }));
  fireEvent.click(await screen.findByRole("button", { name: "预览" }));
  const opened = useWindowStore.getState().windows[0]?.tabs[0];
  expect(opened).toMatchObject({
    kind: "browser",
    resourceId: `browser:${processId}:/`,
    browser: { serviceId: processId, path: "/", targetKind: "process" },
    projectId: "prj_1",
  });
});

it("confirms before stopping the process group", async () => {
  renderWindow();
  fireEvent.click(await screen.findByRole("button", { name: /web/ }));
  fireEvent.click(await screen.findByRole("button", { name: "停止" }));
  expect(await screen.findByText("停止服务？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "确认停止" }));
  await waitFor(() => expect(stopProcess).toHaveBeenCalledWith(processId));
});

it("shows an empty state without any manual registration entry", async () => {
  vi.mocked(listProcesses).mockResolvedValue([]);
  renderWindow();
  expect(await screen.findByText("当前项目暂无后台服务")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /登记服务/ })).toBeNull();
});
