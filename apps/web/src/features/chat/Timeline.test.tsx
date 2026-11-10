import type { ServerEvent } from "@larness/shared";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { applyServerEvent, eventsToTimeline } from "@/lib/eventReducer";
import { useTimelineStore } from "@/stores/timelineStore";
import { Timeline } from "./Timeline";

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
it("shows a spinner at the process summary while the turn is running", () => {
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
