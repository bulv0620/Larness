import type { PlanItem, ServerEvent, ToolItem } from "@larness/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { applyServerEvent, eventsToTimeline } from "@/lib/eventReducer";
import { turnState, useTimelineStore } from "@/stores/timelineStore";
import { Timeline } from "./Timeline";

const resumeTurn = vi.fn(async () => ({
  turnId: "turn-resumed",
  status: "QUEUED",
  sessionId: "s1",
  resumedFromTurnId: "turn-1",
}));

vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  resumeTurn: () => resumeTurn(),
}));

vi.mock("./CommandCard", () => ({
  CommandCard: ({ commandId }: { commandId: string }) => (
    <div role="log" aria-label="命令输出">
      {commandId}
    </div>
  ),
}));

beforeEach(() => {
  useTimelineStore.setState({
    items: [],
    loading: false,
    turn: turnState(),
    scrollToLatestNonce: 0,
  });
});

it("jumps back to the latest output when a message is sent from a scrolled position", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "old",
        kind: "message",
        role: "user",
        text: "上一条消息",
        createdAt: 1,
      },
    ],
  });
  render(<Timeline />);
  const log = screen.getByRole("log", { name: "会话时间线" });
  Object.defineProperty(log, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(log, "clientHeight", { configurable: true, value: 300 });
  log.scrollTop = 120;
  fireEvent.scroll(log);
  expect(screen.getByRole("button", { name: "回到最新消息" })).toBeInTheDocument();

  act(() => {
    useTimelineStore.setState((state) => ({ scrollToLatestNonce: state.scrollToLatestNonce + 1 }));
  });

  expect(log.scrollTop).toBeGreaterThan(300);
  expect(screen.queryByRole("button", { name: "回到最新消息" })).toBeNull();
});

it("keeps the final answer visible when a completed tool event arrives after the message", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "list",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        durationMs: 10,
      },
      {
        id: "commentary",
        kind: "message",
        role: "assistant",
        text: "我先看一下。",
        createdAt: 2,
        turnId: "turn-1",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "项目文件已列出。",
        createdAt: 3,
        turnId: "turn-1",
      },
      {
        id: "tool",
        kind: "tool",
        name: "list_files",
        summary: "list .",
        args: "",
        status: "done",
        createdAt: 4,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);
  expect(screen.getByText("项目文件已列出。")).toBeVisible();
});
it("grows the streamed reply as commentary and promotes it to the answer at completion", () => {
  const user = {
    id: "user",
    kind: "message",
    role: "user",
    text: "list",
    createdAt: 1,
    turnId: "turn-1",
  } as const;
  const reply = {
    id: "answer",
    kind: "message",
    role: "assistant",
    text: "项目文件",
    createdAt: 2,
    turnId: user.turnId,
    streaming: true,
  } as const;
  useTimelineStore.setState({
    items: [user, reply],
    turn: turnState("running", user.turnId),
  });
  render(<Timeline />);
  // While the turn streams, the reply stays a commentary bubble: one stable
  // node that grows with the text, never masquerading as the final answer.
  const streamed = screen.getByTestId("message-bubble");
  expect(streamed).toHaveTextContent("项目文件");
  expect(screen.queryByTestId("final-answer-bubble")).toBeNull();

  act(() => {
    useTimelineStore.setState({
      items: [user, { ...reply, text: "项目文件已列出。" }],
    });
  });
  expect(screen.getByTestId("message-bubble")).toBe(streamed);

  act(() => {
    useTimelineStore.setState({
      items: [
        { ...user, turnOutcome: "completed" },
        { ...reply, text: "项目文件已列出。", streaming: false },
      ],
      turn: turnState(),
    });
  });
  // Completion promotes the finished text into the answer bubble exactly once.
  const bubble = screen.getByTestId("final-answer-bubble");
  expect(bubble).toHaveTextContent("项目文件已列出。");
  expect(within(bubble).queryByRole("button", { name: "复制答复" })).toBeNull();
});

it("shows a pulsing icon and a short category instead of the full command", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user-running",
        kind: "message",
        role: "user",
        text: "run",
        createdAt: 1,
        turnId: "turn-running",
      },
      {
        id: "tool-running",
        kind: "tool",
        name: "run_command",
        summary: "运行命令（本机账户权限）",
        commandLabel: "pnpm --filter @larness/web build --debug",
        args: "",
        status: "running",
        createdAt: 2,
        turnId: "turn-running",
      },
    ],
    turn: turnState("running", "turn-running"),
  });
  render(<Timeline />);
  const header = screen.getByRole("button", { name: /执行过程 · Running\.\.\. · 命令/ });
  expect(header.querySelector(".process-sparkle")).not.toBeNull();
  expect(header.querySelector(".process-status-shimmer")).not.toBeNull();
  expect(header).not.toHaveTextContent("pnpm");
  // The step count is a right-edge measurement, not part of the truncating
  // activity text that gives way on narrow screens.
  const metrics = within(header).getByTestId("process-metrics");
  expect(metrics).toHaveTextContent("1 步");
  expect(header.querySelector(".truncate")?.contains(metrics)).toBe(false);
  expect(header).toHaveAccessibleName(/Running\.\.\. · 命令 · 1 步/);
  expect(screen.queryByTestId("turn-running-spinner")).toBeNull();
});

it("reports a pending approval on the turn header", () => {
  useTimelineStore.setState({
    items: [{ id: "approval", kind: "approval", status: "pending", createdAt: 1 }],
    turn: turnState("running"),
  });
  render(<Timeline />);
  expect(
    screen.getByRole("button", { name: /执行过程 · Waiting for approval\.\.\./ }),
  ).toBeTruthy();
});

it("summarizes tool calls and opens individual command output directly from a failure", () => {
  const tool = (name: string, summary: string, commandId?: string): ToolItem => ({
    id: summary,
    kind: "tool",
    name,
    summary,
    commandId,
    args: "",
    status: commandId === "failed-command" ? "error" : "done",
    createdAt: 1,
    turnId: "t1",
  });
  useTimelineStore.setState({
    items: [
      {
        id: "u",
        kind: "message",
        role: "user",
        text: "验证",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
      },
      tool("read_file", "读取 README"),
      tool("apply_patch", "修改 README"),
      tool("run_command", "第一次检查", "failed-command"),
      tool("run_command", "重试检查", "passed-command"),
    ],
  });
  render(<Timeline />);
  const summary = screen.getByRole("button", {
    name: /执行过程 · Completed · 4 步/,
  });
  const failure = screen.getByRole("button", { name: /第一次检查.*失败/ });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByLabelText("命令输出")).toBeNull();
  fireEvent.click(failure);
  expect(screen.getByLabelText("命令输出")).toHaveTextContent("failed-command");
  fireEvent.click(summary);
  expect(screen.getByLabelText("命令输出")).toHaveTextContent("failed-command");
  fireEvent.click(screen.getByRole("button", { name: "重试检查" }));
  expect(screen.getAllByLabelText("命令输出")).toHaveLength(2);
});

it("merges an automatically continued turn into the task it continues", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "重构 todo 页面",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "第一步已完成。",
        createdAt: 2,
        turnId: "t1",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: 'Work state checkpoint (verified facts, observed at 3).\n{"goal":"重构 todo"}',
        createdAt: 3,
        turnId: "t2",
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "全部完成。",
        createdAt: 4,
        turnId: "t2",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getAllByLabelText("对话轮次")).toHaveLength(1);
  expect(screen.queryByText("自动继续上一轮的未完成工作")).toBeNull();
  expect(screen.getByText("重构 todo 页面")).toBeTruthy();
  expect(screen.queryByText(/"goal":"重构 todo"/)).toBeNull();
});

it("marks an automatically continued turn without dumping the checkpoint", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u",
        kind: "message",
        role: "user",
        text: 'Work state checkpoint (verified facts, observed at 1).\n{"goal":"重构 todo"}',
        createdAt: 1,
        turnId: "t2",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByText("自动继续上一轮的未完成工作")).toBeTruthy();
  expect(screen.queryByText(/"goal":"重构 todo"/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看核对事实" }));
  expect(screen.getByText(/"goal":"重构 todo"/)).toBeTruthy();
});

it("wraps each step's commentary in the same bubble as the answer", () => {
  useTimelineStore.setState({
    turn: turnState("running", "t1"),
    items: [
      {
        id: "u",
        kind: "message",
        role: "user",
        text: "重构 todo 页面",
        createdAt: 1,
        turnId: "t1",
      },
      {
        id: "c1",
        kind: "message",
        role: "assistant",
        text: "现在让我看看当前详细视觉设计。",
        createdAt: 2,
        turnId: "t1",
      },
      {
        id: "tool",
        kind: "tool",
        name: "read_file",
        summary: "读取 style.css",
        args: "",
        status: "done",
        createdAt: 3,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  const bubble = screen.getByTestId("message-bubble");
  expect(bubble).toHaveTextContent("现在让我看看当前详细视觉设计。");
  // The final answer slot is only used once the turn ends with an answer.
  expect(screen.queryByTestId("final-answer-bubble")).toBeNull();
});

it("folds failed steps into the record once the turn has an answer", () => {
  const failedTool: ToolItem = {
    id: "failed-step",
    kind: "tool",
    name: "run_command",
    summary: "运行命令（本机账户权限）",
    commandId: "failed-command",
    args: "",
    status: "error",
    createdAt: 2,
    turnId: "t1",
  };
  useTimelineStore.setState({
    items: [
      {
        id: "u",
        kind: "message",
        role: "user",
        text: "生成一个 SVG",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        durationMs: 317_000,
      },
      failedTool,
      {
        id: "a",
        kind: "message",
        role: "assistant",
        text: "已创建 pelican-on-bicycle.svg。",
        createdAt: 3,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  const summary = screen.getByRole("button", {
    name: /执行过程 · Completed.*1 步/,
  });
  expect(summary).not.toHaveTextContent("失败");
  expect(summary.querySelector(".process-sparkle")).toBeNull();
  expect(summary.querySelector(".process-status-shimmer")).toBeNull();
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: /运行命令.*失败/ })).toBeNull();

  fireEvent.click(summary);
  expect(screen.getByRole("button", { name: /运行命令.*失败/ })).toBeTruthy();
});

it("does not surface failure counts in the outer header", () => {
  const failure = (id: string, retried?: boolean): ToolItem => ({
    id,
    kind: "tool",
    name: "run_command",
    summary: "运行命令（本机账户权限）",
    args: "",
    status: "error",
    ...(retried === true ? { retried: true } : {}),
    createdAt: 2,
    turnId: "t1",
  });
  useTimelineStore.setState({
    items: [
      {
        id: "u",
        kind: "message",
        role: "user",
        text: "跑检查",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
      },
      failure("f1"),
      failure("f2", true),
      {
        id: "a",
        kind: "message",
        role: "assistant",
        text: "检查完成。",
        createdAt: 3,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  const summary = screen.getByRole("button", {
    name: /执行过程 · Completed · 2 步/,
  });
  expect(summary).toBeTruthy();
  expect(summary).not.toHaveTextContent("失败");
  expect(summary).not.toHaveTextContent("重试");
  expect(screen.queryByRole("button", { name: /运行命令.*失败/ })).toBeNull();
});

it.each(["completed", "cancelled"] as const)(
  "holds results until the current turn is %s",
  (outcome) => {
    const turnId = "turn-results";
    const fileButton = { name: "查看文件 · note.txt" };
    useTimelineStore.setState({
      turn: turnState("running", turnId),
      items: [
        { id: "user", kind: "message", role: "user", text: "更新文档", createdAt: 1, turnId },
        {
          id: "tool",
          kind: "tool",
          name: "apply_patch",
          summary: "修改文件",
          args: "",
          status: "done",
          createdAt: 2,
          turnId,
          resourceTarget: { kind: "file", scope: { projectId: "project" }, path: "note.txt" },
        },
        {
          id: "report",
          kind: "artifact",
          title: "检查报告",
          description: "文档检查结果",
          meta: "",
          createdAt: 3,
          turnId,
        },
        {
          id: "answer",
          kind: "message",
          role: "assistant",
          text: "文档已更新。",
          createdAt: 4,
          turnId,
        },
      ],
    });
    render(<Timeline />);
    expect(screen.getByText("文档已更新。")).toBeVisible();
    expect(screen.queryByRole("region", { name: "本次成果" })).not.toBeInTheDocument();
    expect(screen.queryByText("检查报告")).not.toBeInTheDocument();

    act(() => {
      useTimelineStore.setState((state) => ({
        turn: turnState(),
        items: state.items.map((item) =>
          item.id === "user" && item.kind === "message" ? { ...item, turnOutcome: outcome } : item,
        ),
      }));
    });
    const results = screen.getByRole("region", { name: "本次成果" });
    expect(within(results).getByRole("button", fileButton)).toBeVisible();
    const artifact = screen.getByText("检查报告");
    const answer = screen.getByText("文档已更新。");
    const copy = screen.getByRole("button", { name: "复制答复" });
    const time = screen.getByRole("time");
    expect(artifact).toBeVisible();
    expect(answer.compareDocumentPosition(results)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(results.compareDocumentPosition(copy)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(artifact.compareDocumentPosition(time)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    act(() => useTimelineStore.setState({ turn: turnState("running", "turn-next") }));
    expect(within(results).getByRole("button", fileButton)).toBeVisible();
  },
);

// A settled turn keeps the model's last report. A step still running was cut
// off, not failed, so it names the reason instead of borrowing the failure mark.
const settledTerminals = [
  "turn.interrupted",
  "turn.cancelled",
  "turn.failed",
  "turn.completed",
] as const;
const settledPlanLabel = {
  "turn.interrupted": "已中断",
  "turn.cancelled": "已停止",
  "turn.failed": "已中断",
  "turn.completed": "未标记完成",
} as const;

it.each(settledTerminals)("keeps a settled plan honest on %s and on replay", (terminalEvent) => {
  const label = settledPlanLabel[terminalEvent];
  const turnId = "turn-plan";
  const base = {
    kind: "event",
    protocolVersion: 1,
    topic: "agent",
    streamId: "session",
    timestamp: 1,
  } as const;
  const start: ServerEvent[] = [
    {
      ...base,
      eventId: "user",
      sequence: 1,
      type: "user.message",
      payload: { turnId, text: "更新样式" },
    },
    {
      ...base,
      eventId: "plan",
      sequence: 2,
      type: "plan.updated",
      payload: {
        turnId,
        plan: {
          id: "plan-turn",
          kind: "plan",
          turnId,
          title: "样式调整",
          createdAt: 1,
          steps: [
            { id: "read", title: "读取样式", status: "done" },
            { id: "edit", title: "修改样式", detail: "改动 12 行", status: "running" },
            { id: "verify", title: "验证页面", status: "pending" },
          ],
        },
      },
    },
  ];
  const terminal: ServerEvent = {
    ...base,
    eventId: "terminal",
    sequence: 3,
    type: terminalEvent,
    payload: { turnId },
  };
  useTimelineStore.setState({
    items: eventsToTimeline(start),
    turn: turnState("running", turnId),
  });
  const view = render(<Timeline />);
  // Steps are always visible: no click, no progress bar.
  const plan = screen.getByRole("list", { name: "计划 · 1/3 · 样式调整" });
  expect(plan).toHaveAccessibleName("计划 · 1/3 · 样式调整");
  // The detail reaches the store, so the next assertion is not vacuous.
  const stored = useTimelineStore
    .getState()
    .items.find((entry): entry is PlanItem => entry.kind === "plan");
  expect(stored?.steps[1]?.detail).toBe("改动 12 行");
  // A row shows the step title alone: the optional step detail stays out of the card.
  expect(within(plan).queryByText("改动 12 行")).toBeNull();
  // The running step is the current one, not a failure and not a second glow.
  expect(plan.querySelector('li[aria-current="step"]')).toHaveTextContent("修改样式");
  expect(plan.querySelector(".animate-spin")).toBeInTheDocument();
  // While the turn runs, the step is just in progress.
  expect(within(plan).queryByText(label, { exact: true })).toBeNull();

  act(() => {
    useTimelineStore.setState((state) => ({
      items: applyServerEvent(state.items, terminal),
      turn: turnState(),
    }));
  });
  // The settled summary reports how many steps stayed open, and the reason is
  // stated instead of a red failure mark.
  expect(
    screen.getByRole("list", { name: "计划 · 1/3 · 样式调整 · 另有 2 步未完成" }),
  ).toBeTruthy();
  const finishedPlan = screen.getByRole("list", { name: /^计划 · 1\/3 · 样式调整/ });
  expect(finishedPlan.querySelector(".animate-spin")).not.toBeInTheDocument();
  expect(within(finishedPlan).getByText(label, { exact: true })).toBeVisible();
  expect(finishedPlan.querySelector(".text-danger")).toBeNull();
  expect(within(finishedPlan).getByText("已完成：", { exact: true })).toBeInTheDocument();
  expect(within(finishedPlan).getByText("待做：", { exact: true })).toBeInTheDocument();

  view.unmount();
  useTimelineStore.setState({
    items: eventsToTimeline([...start, terminal]),
    turn: turnState("running", "turn-next"),
  });
  render(<Timeline />);
  const replayedPlan = screen.getByRole("list", { name: /^计划 · 1\/3 · 样式调整/ });
  expect(replayedPlan.querySelector(".animate-spin")).not.toBeInTheDocument();
  expect(within(replayedPlan).getByText(label, { exact: true })).toBeVisible();
  expect(replayedPlan.querySelector(".text-danger")).toBeNull();
});

it("counts only open steps in the summary and keeps a failure a failure", () => {
  useTimelineStore.setState({
    turn: turnState(),
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "发布检查",
        createdAt: 1,
        turnId: "turn-settled",
        turnOutcome: "completed",
        durationMs: 1_000,
      },
      {
        id: "plan",
        kind: "plan",
        turnId: "turn-settled",
        title: "发布检查",
        createdAt: 2,
        steps: [
          { id: "lint", title: "跑 lint", status: "done" },
          { id: "test", title: "跑测试", status: "failed" },
          { id: "ship", title: "发布", status: "pending" },
        ],
      },
    ],
  });

  render(<Timeline />);

  // A failure already reads as one; only the open step is counted.
  expect(
    screen.getByRole("list", { name: "计划 · 1/3 · 发布检查 · 另有 1 步未完成" }),
  ).toBeTruthy();
  const plan = screen.getByRole("list", { name: /^计划 · 1\/3 · 发布检查/ });
  expect(within(plan).getByText("失败：", { exact: true })).toBeInTheDocument();
  expect(within(plan).getByText("待做：", { exact: true })).toBeInTheDocument();
  expect(plan.querySelector(".text-danger")).toBeInTheDocument();
});

it("adds no open counter when every step is settled", () => {
  useTimelineStore.setState({
    turn: turnState(),
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "发布检查",
        createdAt: 1,
        turnId: "turn-settled",
        turnOutcome: "completed",
        durationMs: 1_000,
      },
      {
        id: "plan",
        kind: "plan",
        turnId: "turn-settled",
        title: "发布检查",
        createdAt: 2,
        steps: [
          { id: "lint", title: "跑 lint", status: "done" },
          { id: "test", title: "跑测试", status: "failed" },
          { id: "doc", title: "补文档", status: "done" },
        ],
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByRole("list", { name: "计划 · 2/3 · 发布检查" })).toBeTruthy();
});

it("reads a turn that never settled as unmarked rather than failed", () => {
  useTimelineStore.setState({
    turn: turnState(),
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "整理文档",
        createdAt: 1,
        turnId: "turn-orphan",
      },
      {
        id: "plan",
        kind: "plan",
        turnId: "turn-orphan",
        title: "整理文档",
        createdAt: 2,
        steps: [
          { id: "read", title: "读取文档", status: "running" },
          { id: "write", title: "改写文档", status: "pending" },
        ],
      },
    ],
  });

  render(<Timeline />);

  expect(
    screen.getByRole("list", { name: "计划 · 0/2 · 整理文档 · 另有 2 步未完成" }),
  ).toBeTruthy();
  const plan = screen.getByRole("list", { name: /^计划 · 0\/2 · 整理文档/ });
  expect(within(plan).getByText("未标记完成", { exact: true })).toBeVisible();
  expect(plan.querySelector(".text-danger")).toBeNull();
});

it("shows Thinking... without rendering reasoning text", () => {
  const user = {
    id: "u",
    kind: "message",
    role: "user",
    text: "think",
    createdAt: 1,
    turnId: "t1",
  } as const;
  const reasoning = {
    id: "r",
    kind: "reasoning",
    text: "先分析目录结构。",
    createdAt: 2,
    turnId: "t1",
    streaming: true,
  } as const;
  const tool = {
    id: "tool",
    kind: "tool",
    name: "list_files",
    summary: "列出文件",
    args: "",
    status: "done",
    createdAt: 3,
    turnId: "t1",
  } as const;

  useTimelineStore.setState({
    items: [user, reasoning, tool],
    turn: turnState("running", "t1"),
  });
  render(<Timeline />);

  const summary = screen.getByRole("button", { name: /执行过程 · Thinking\.\.\./ });
  expect(summary).not.toHaveTextContent("先分析目录结构。");
  expect(screen.queryByText("先分析目录结构。")).toBeNull();

  act(() => {
    useTimelineStore.setState({
      items: [
        { ...user, turnOutcome: "completed", durationMs: 2_000 },
        { ...reasoning, streaming: false },
        tool,
        { id: "a", kind: "message", role: "assistant", text: "完成", createdAt: 4, turnId: "t1" },
      ],
      turn: turnState(),
    });
  });

  const finished = screen.getByRole("button", { name: /执行过程 · Completed · 2s/ });
  expect(finished).not.toHaveTextContent("先分析目录结构。");
  // The clock stays with the left-hand activity; only the step count is pinned
  // to the right edge.
  expect(within(finished).getByText("2s")).toBeVisible();
  expect(within(finished).getByTestId("process-metrics")).toHaveTextContent("1 步");
  expect(within(finished).getByTestId("process-metrics")).not.toHaveTextContent("2s");
  expect(finished).toHaveAccessibleName(/Completed · 2s · 1 步/);
  fireEvent.click(finished);
  expect(screen.getByText("完成")).toBeVisible();
  expect(screen.queryByText("先分析目录结构。")).toBeNull();
});

it("offers to resume an interrupted turn after an explicit confirmation", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "跑完测试",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "interrupted",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.queryByRole("button", { name: "确认继续" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续这个任务" }));
  expect(screen.getByText(/继续会新建一轮/)).toBeTruthy();
  expect(resumeTurn).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "确认继续" }));
  expect(resumeTurn).toHaveBeenCalledTimes(1);
});

it("does not offer resume for a cancelled turn", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "停一下",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "cancelled",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.queryByRole("button", { name: "继续这个任务" })).toBeNull();
});

it("leaves only the resume entry on an interrupted turn", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "跑完测试",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "interrupted",
      },
      {
        id: "interrupted_turn-1",
        kind: "error",
        turnId: "turn-1",
        message: "执行已中断，请重新发送任务。",
        createdAt: 2,
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByRole("button", { name: "继续这个任务" })).toBeTruthy();
  expect(screen.queryByText("执行已中断，请重新发送任务。")).toBeNull();
  expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
});

it("keeps the retry entry when a turn failed", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "跑完测试",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "failed",
      },
      {
        id: "error_turn-1",
        kind: "error",
        turnId: "turn-1",
        message: "PROVIDER_UNAVAILABLE: provider request timed out",
        createdAt: 2,
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByText(/provider request timed out/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "继续这个任务" })).toBeNull();
});

it("shows deliverables and keeps process files out of the results", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "写文件",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        fileResults: [
          {
            path: "docs/report.md",
            changeType: "created",
            version: "v1",
            existed: true,
            category: "deliverable",
          },
          {
            path: "tmp/probe.mjs",
            changeType: "created",
            version: "v2",
            existed: true,
            category: "process",
          },
        ],
      },
      {
        id: "tool-report",
        kind: "tool",
        name: "write_file",
        summary: "create docs/report.md",
        args: "",
        status: "done",
        createdAt: 2,
        turnId: "turn-1",
        resourceTarget: {
          kind: "file",
          scope: { projectId: "project" },
          path: "docs/report.md",
          version: "v1",
        },
      },
      {
        id: "tool-probe",
        kind: "tool",
        name: "write_file",
        summary: "create tmp/probe.mjs",
        args: "",
        status: "done",
        createdAt: 3,
        turnId: "turn-1",
        resourceTarget: {
          kind: "file",
          scope: { projectId: "project" },
          path: "tmp/probe.mjs",
          version: "v2",
        },
      },
      {
        id: "artifact",
        kind: "artifact",
        title: "已创建 docs/report.md",
        description: "文件变更 · created",
        meta: "v1",
        createdAt: 4,
        turnId: "turn-1",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "完成",
        createdAt: 5,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);

  const results = screen.getByRole("region", { name: "本次成果" });
  expect(within(results).getByRole("button", { name: "查看文件 · docs/report.md" })).toBeVisible();
  expect(
    within(results).queryByRole("button", { name: "查看文件 · tmp/probe.mjs" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("已创建 docs/report.md")).not.toBeInTheDocument();

  // The process record still holds the scratch file; the results area does not
  // report it, not even as a count.
  expect(screen.queryByText(/过程文件/)).not.toBeInTheDocument();
  expect(screen.queryByText("tmp/probe.mjs")).not.toBeInTheDocument();
});

it("shows no results area when the turn only left process files", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "清理",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        fileResults: [
          {
            path: "tmp/probe.mjs",
            changeType: "created",
            version: "v1",
            existed: false,
            category: "process",
          },
        ],
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "已清理",
        createdAt: 2,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);

  expect(screen.queryByRole("region", { name: "本次成果" })).not.toBeInTheDocument();
  expect(screen.queryByText(/过程文件/)).not.toBeInTheDocument();
  expect(screen.queryByText("tmp/probe.mjs")).not.toBeInTheDocument();
});

it("notes files beyond the per-turn result cap", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "写很多文件",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        fileResultsOmitted: 3,
        fileResults: [
          {
            path: "docs/report.md",
            changeType: "created",
            version: "v1",
            existed: true,
            category: "deliverable",
          },
        ],
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "完成",
        createdAt: 2,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);

  expect(screen.getByText("另有 3 个文件未列出")).toBeVisible();
});

it("keeps only the leading deliverables in view and folds the rest", () => {
  const paths = ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md", "docs/e.md"];
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "改一批文档",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        fileResults: paths.map((path) => ({
          path,
          changeType: "modified" as const,
          version: "v1",
          existed: true,
          category: "deliverable" as const,
        })),
      },
      ...paths.map(
        (path, index): ToolItem => ({
          id: `tool-${index}`,
          kind: "tool",
          name: "apply_patch",
          summary: `update ${path}`,
          args: "",
          status: "done",
          createdAt: 2 + index,
          turnId: "turn-1",
          resourceTarget: { kind: "file", scope: { projectId: "project" }, path, version: "v1" },
        }),
      ),
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "完成",
        createdAt: 9,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);

  const results = screen.getByRole("region", { name: "本次成果" });
  expect(within(results).getAllByRole("button", { name: /^查看文件 · / })).toHaveLength(3);
  expect(within(results).getByRole("button", { name: "查看文件 · docs/a.md" })).toBeVisible();
  expect(within(results).queryByRole("button", { name: "查看文件 · docs/e.md" })).toBeNull();

  fireEvent.click(within(results).getByRole("button", { name: "展开全部文件" }));

  expect(within(results).getAllByRole("button", { name: /^查看文件 · / })).toHaveLength(5);
  expect(within(results).getByRole("button", { name: "查看文件 · docs/e.md" })).toBeVisible();

  fireEvent.click(within(results).getByRole("button", { name: "收起文件" }));

  expect(within(results).getAllByRole("button", { name: /^查看文件 · / })).toHaveLength(3);
});
