import type { ScheduledJobDto, ScheduledJobRunDto } from "@larness/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { createJob, deleteJob, listJobs, runJobNow, updateJob } from "./api";
import { JobsDialog } from "./JobsDialog";

const now = Date.now();

const job: ScheduledJobDto = {
  id: "job_1",
  name: "每日检查",
  projectId: null,
  kind: "script",
  schedule: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
  enabled: true,
  timeoutSeconds: 600,
  overlapPolicy: "skip",
  missedPolicy: "skip",
  nextRunAt: now + 60_000,
  lastRunAt: now - 60_000,
  lastStatus: "succeeded",
  createdAt: now - 120_000,
  updatedAt: now - 60_000,
  archivedAt: null,
  script: { source: 'console.log("ok")' },
  agent: null,
};

const run: ScheduledJobRunDto = {
  id: "run_1",
  jobId: "job_1",
  trigger: "manual",
  status: "succeeded",
  scheduledFor: now - 60_000,
  startedAt: now - 60_000,
  endedAt: now - 59_000,
  durationMs: 1_000,
  sessionId: null,
  turnId: null,
  exitCode: 0,
  output: "ok",
  errorCode: null,
  errorMessage: null,
  createdAt: now - 60_000,
};

vi.mock("./api", () => ({
  jobsKey: ["jobs"],
  jobsSummaryKey: ["jobs", "summary"],
  jobKey: (id: string) => ["jobs", "detail", id],
  jobRunsKey: (id: string) => ["jobs", "runs", id],
  listJobs: vi.fn(async () => ({ items: [job] })),
  getJob: vi.fn(async () => job),
  listJobRuns: vi.fn(async () => ({ items: [run], nextCursor: null })),
  createJob: vi.fn(async () => job),
  updateJob: vi.fn(async () => ({ ...job, enabled: false })),
  deleteJob: vi.fn(async () => undefined),
  runJobNow: vi.fn(async () => run),
  cancelJobRun: vi.fn(async () => run),
}));

vi.mock("@/lib/workspaceApi", () => ({
  listProjects: vi.fn(async () => []),
  listModelCatalog: vi.fn(async () => ({ groups: [] })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <JobsDialog open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

it("shows a list read error without presenting it as an empty list", async () => {
  vi.mocked(listJobs).mockRejectedValueOnce(new Error("unavailable"));
  renderDialog();

  expect(await screen.findByRole("alert")).toHaveTextContent("任务列表读取失败");
  expect(screen.queryByText("还没有定时任务")).toBeNull();
});

it("shows one dismissible message for a failed save and keeps the form editable", async () => {
  vi.mocked(createJob).mockRejectedValueOnce(new Error("internal transport failure"));
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: "新建任务" }));
  const name = screen.getByRole("textbox", { name: "名称" });
  fireEvent.change(name, { target: { value: "待重试的任务" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("保存任务失败，请重试");
  expect(screen.queryByText("internal transport failure")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "关闭错误消息" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(name).toHaveValue("待重试的任务");
  expect(screen.getByRole("button", { name: "保存" })).toBeEnabled();
});

it("lists jobs, opens the detail, shows the run history and runs manually", async () => {
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: /每日检查.*成功/ }));
  expect(await screen.findByText("运行历史")).toBeVisible();
  expect(await screen.findByText("ok")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "立即执行" }));
  await waitFor(() => expect(runJobNow).toHaveBeenCalledWith("job_1"));
});

it("disables a job from the detail view", async () => {
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: /每日检查.*成功/ }));
  fireEvent.click(await screen.findByRole("button", { name: "停用" }));
  await waitFor(() => expect(updateJob).toHaveBeenCalledWith("job_1", { enabled: false }));
});

it("creates a script job from the form", async () => {
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: "新建任务" }));
  expect(screen.getByText("脚本以本机账户权限运行，可访问项目外文件和网络。")).toBeVisible();
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "新的任务" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() =>
    expect(createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "新的任务",
        kind: "script",
        schedule: expect.objectContaining({ type: "cron" }),
      }),
    ),
  );
});

it("requires a risk confirmation for autonomous Agent jobs", async () => {
  const user = userEvent.setup();
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: "新建任务" }));
  fireEvent.change(screen.getByLabelText("名称"), { target: { value: "Agent 任务" } });
  await user.click(screen.getByRole("button", { name: "类型" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Agent" }));
  fireEvent.change(screen.getByLabelText("Agent 提示词"), {
    target: { value: "检查项目" },
  });
  await user.click(screen.getByRole("button", { name: "审批策略" }));
  await user.click(screen.getByRole("menuitemradio", { name: "完全自主" }));
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("请先确认完全自主风险");
  expect(createJob).not.toHaveBeenCalled();
});

it("deletes a job after confirmation", async () => {
  renderDialog();
  fireEvent.click(await screen.findByRole("button", { name: /每日检查.*成功/ }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  expect(await screen.findByText(/删除后不再触发/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(deleteJob).toHaveBeenCalledWith("job_1"));
});
