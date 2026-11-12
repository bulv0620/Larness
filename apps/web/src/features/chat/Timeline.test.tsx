import type { ServerEvent, ToolItem } from "@larness/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { applyServerEvent, eventsToTimeline } from "@/lib/eventReducer";
import { useTimelineStore } from "@/stores/timelineStore";
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
    isStreaming: false,
    activeTurnId: null,
  });
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
it("keeps the same reply bubble from the first streamed text through completion", () => {
  const user = {
    id: "user",
    kind: "message",
    role: "user",
    text: "list",
    createdAt: 1,
    turnId: "turn-1",
  } as const;
  const answer = {
    id: "answer",
    kind: "message",
    role: "assistant",
    text: "项目文件",
    createdAt: 2,
    turnId: user.turnId,
    streaming: true,
  } as const;
  useTimelineStore.setState({
    items: [user, answer],
    activeTurnId: user.turnId,
    isStreaming: true,
  });
  render(<Timeline />);
  const bubble = screen.getByTestId("final-answer-bubble");
  expect(bubble).toHaveTextContent("项目文件");

  act(() => {
    useTimelineStore.setState({
      items: [
        { ...user, turnOutcome: "completed" },
        { ...answer, text: "项目文件已列出。", streaming: false },
      ],
      activeTurnId: null,
      isStreaming: false,
    });
  });
  expect(screen.getByTestId("final-answer-bubble")).toBe(bubble);
  expect(bubble).toHaveTextContent("项目文件已列出。");
  expect(within(bubble).queryByRole("button", { name: "复制答复" })).toBeNull();
});

it("shows the current tool and a spinner outside the scrollable transcript", () => {
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
        name: "start_project_terminal",
        summary: "启动终端",
        args: "",
        status: "running",
        createdAt: 2,
        turnId: "turn-running",
      },
    ],
    activeTurnId: "turn-running",
    isStreaming: true,
  });
  render(<Timeline />);
  expect(screen.getByTestId("turn-running-spinner")).toBeTruthy();
  expect(screen.getByRole("status", { name: "当前执行状态" })).toHaveTextContent("启动终端");
  expect(
    within(screen.getByRole("log", { name: "会话时间线" })).queryByText("正在执行 · 启动终端"),
  ).toBeNull();
});

it("reports a pending approval outside the transcript even before the turn is restored", () => {
  useTimelineStore.setState({
    items: [{ id: "approval", kind: "approval", status: "pending", createdAt: 1 }],
  });
  render(<Timeline />);
  expect(screen.getByRole("status", { name: "当前执行状态" })).toHaveTextContent("等待审批");
  expect(screen.queryByTestId("turn-running-spinner")).toBeNull();
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
    name: /执行过程 · 探索 1 项 · 修改 1 项 · 命令 2 条/,
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

it("wraps each step's commentary in the same bubble as the answer", () => {
  useTimelineStore.setState({
    isStreaming: true,
    activeTurnId: "t1",
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
    name: /执行过程 · 命令 1 条 · 失败 1 项/,
  });
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: /运行命令.*失败/ })).toBeNull();

  fireEvent.click(summary);
  expect(screen.getByRole("button", { name: /运行命令.*失败/ })).toBeTruthy();
});

it.each(["completed", "cancelled"] as const)(
  "holds results until the current turn is %s",
  (outcome) => {
    const turnId = "turn-results";
    const fileButton = { name: "查看文件 · note.txt" };
    useTimelineStore.setState({
      isStreaming: true,
      activeTurnId: turnId,
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
        isStreaming: false,
        activeTurnId: null,
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

    act(() => useTimelineStore.setState({ isStreaming: true, activeTurnId: "turn-next" }));
    expect(within(results).getByRole("button", fileButton)).toBeVisible();
  },
);

it.each(["turn.interrupted", "turn.cancelled", "turn.failed", "turn.completed"])(
  "stops an unfinished plan on %s and keeps it stopped on replay",
  (terminalEvent) => {
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
              { id: "edit", title: "修改样式", status: "running" },
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
      isStreaming: true,
      activeTurnId: turnId,
    });
    const view = render(<Timeline />);
    fireEvent.click(screen.getByRole("button", { name: "计划 · 1/3 · 修改样式" }));
    const plan = screen.getByRole("list", { name: "样式调整" });
    expect(plan.querySelector(".animate-spin")).toBeInTheDocument();

    act(() => {
      useTimelineStore.setState((state) => ({
        items: applyServerEvent(state.items, terminal),
        isStreaming: false,
        activeTurnId: null,
      }));
    });
    const finishedPlan = screen.getByRole("list", { name: "样式调整" });
    expect(finishedPlan.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(within(finishedPlan).getByText("未完成", { exact: true })).toBeVisible();
    expect(within(finishedPlan).getByText("已完成：", { exact: true })).toBeInTheDocument();
    expect(within(finishedPlan).getByText("待做：", { exact: true })).toBeInTheDocument();

    view.unmount();
    useTimelineStore.setState({
      items: eventsToTimeline([...start, terminal]),
      isStreaming: true,
      activeTurnId: "turn-next",
    });
    render(<Timeline />);
    fireEvent.click(screen.getByRole("button", { name: /^计划 · 1\/3/ }));
    const replayedPlan = screen.getByRole("list", { name: "样式调整" });
    expect(replayedPlan.querySelector(".animate-spin")).not.toBeInTheDocument();
    expect(within(replayedPlan).getByText("未完成", { exact: true })).toBeVisible();
  },
);

it("shows a single-line reasoning preview and keeps it out of the expanded process", () => {
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

  useTimelineStore.setState({
    items: [user, reasoning],
    isStreaming: true,
    activeTurnId: "t1",
  });
  render(<Timeline />);

  const summary = screen.getByRole("button", { name: /执行过程 · 正在思考/ });
  expect(summary).toHaveTextContent("先分析目录结构。");
  expect(screen.queryByText("先分析目录结构。")).toBeNull();

  act(() => {
    useTimelineStore.setState({
      items: [
        { ...user, turnOutcome: "completed", durationMs: 2_000 },
        { ...reasoning, streaming: false },
        { id: "a", kind: "message", role: "assistant", text: "完成", createdAt: 3, turnId: "t1" },
      ],
      isStreaming: false,
      activeTurnId: null,
    });
  });

  const finished = screen.getByRole("button", { name: /执行过程 · 执行了 0 项操作/ });
  expect(finished).not.toHaveTextContent("先分析目录结构。");
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
