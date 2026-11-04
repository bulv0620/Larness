import type { TimelineItem } from "@larness/shared";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { Composer } from "./Composer";
import { PendingApproval } from "./PendingApproval";
import { Timeline } from "./Timeline";

vi.mock("@/lib/queries", () => ({
  useSnapshot: () => ({
    data: {
      models: [{ id: "deepseek-default", label: "DeepSeek", maxContextTokens: 128000 }],
      projects: [],
      sessions: [],
    },
  }),
}));
const base: TimelineItem[] = [
  { id: "u", kind: "message", role: "user", text: "修复", turnId: "turn_a", createdAt: 1 },
  {
    id: "m",
    kind: "message",
    role: "assistant",
    text: "先检查文件",
    turnId: "turn_a",
    createdAt: 2,
  },
  {
    id: "t",
    kind: "tool",
    name: "read_file",
    summary: "读取文件",
    args: "",
    status: "done",
    createdAt: 3,
  },
  {
    id: "f",
    kind: "message",
    role: "assistant",
    text: "已完成修复",
    turnId: "turn_a",
    createdAt: 4,
  },
];
const approval: TimelineItem = {
  id: "apv_a",
  kind: "approval",
  toolName: "run_command",
  summary: "pnpm check",
  status: "pending",
  createdAt: 5,
  expiresAt: Date.now() + 60000,
};
beforeEach(() => {
  useNavigationStore.setState({ sessionId: "test-session", projectId: null });
  useTimelineStore.setState({
    items: [],
    sessionId: "test-session",
    isStreaming: false,
    loading: false,
    activeTurnId: null,
  });
});
it("keeps commentary inside a collapsed turn process and final answer outside", () => {
  useTimelineStore.setState({ items: base });
  render(<Timeline />);
  expect(screen.getByText("已完成修复")).toBeVisible();
  expect(screen.queryByText("先检查文件")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /执行了 1 项操作/ }));
  expect(screen.getByText("先检查文件")).toBeVisible();
  expect(screen.getAllByText("已完成修复")).toHaveLength(1);
  act(() =>
    useTimelineStore.setState({
      items: [...base, { id: "u2", kind: "message", role: "user", text: "下一轮", createdAt: 6 }],
    }),
  );
  expect(screen.getByText("先检查文件")).toBeVisible();
});
it("shows no empty process for a plain answer and renders a real collapsible plan", () => {
  useTimelineStore.setState({
    items: [base[0], base[3]].filter((item): item is TimelineItem => Boolean(item)),
  });
  const view = render(<Timeline />);
  expect(screen.queryByRole("button", { name: /项操作/ })).toBeNull();
  act(() =>
    useTimelineStore.setState({
      items: [
        ...useTimelineStore.getState().items,
        {
          id: "p",
          kind: "plan",
          title: "修复",
          steps: [
            { id: "a", title: "检查", status: "done" },
            { id: "b", title: "验证", status: "running" },
          ],
          createdAt: 7,
        },
      ],
    }),
  );
  fireEvent.click(screen.getByText(/计划 · 1\/2/));
  expect(screen.getByText("检查")).toBeVisible();
  view.unmount();
});
it("puts interactive approval only above composer; retains it until confirmed and on failure", async () => {
  let confirm: (() => void) | undefined;
  const resolve = vi.fn(
    () =>
      new Promise<void>((done) => {
        confirm = done;
      }),
  );
  useTimelineStore.setState({
    items: [...base, approval],
    isStreaming: true,
    resolveApproval: resolve,
  });
  render(
    <>
      <Timeline />
      <footer>
        <PendingApproval />
        <Composer />
      </footer>
    </>,
  );
  const panel = screen.getByRole("region", { name: "待处理审批" });
  expect(
    within(screen.getByRole("log", { name: "会话时间线" })).queryByRole("button", {
      name: "批准执行",
    }),
  ).toBeNull();
  fireEvent.click(within(panel).getByRole("button", { name: "批准执行" }));
  expect(panel).toBeVisible();
  expect(within(panel).getByRole("button", { name: "批准执行" })).toBeDisabled();
  await act(async () => {
    confirm?.();
  });
  expect(resolve).toHaveBeenCalledTimes(1);
});
it("shows approval failure inline, disables expired requests and navigates multiple requests", async () => {
  const resolve = vi.fn().mockRejectedValue(new Error("offline"));
  useTimelineStore.setState({
    items: [approval, { ...approval, id: "apv_b", summary: "other", expiresAt: 1 }],
    resolveApproval: resolve,
  });
  render(<PendingApproval />);
  fireEvent.click(screen.getByRole("button", { name: "批准执行" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  expect(screen.getByRole("button", { name: "批准执行" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "下一项审批" }));
  expect(screen.getByText("other")).toBeVisible();
  expect(screen.getByRole("button", { name: "批准执行" })).toBeDisabled();
});
it("Enter never stops a running turn and IME Enter never sends; stop stays explicit", async () => {
  const stop = vi.fn();
  const send = vi.fn();
  useTimelineStore.setState({ isStreaming: true, stop, send });
  render(<Composer />);
  const input = screen.getByRole("textbox", { name: "对话输入" });
  fireEvent.change(input, { target: { value: "下一个任务" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(stop).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "停止执行" }));
  expect(stop).toHaveBeenCalledTimes(1);
  act(() => useTimelineStore.setState({ isStreaming: false }));
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(send).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(send).toHaveBeenCalledWith("下一个任务"));
  expect(screen.queryByText(/正在执行，可先编辑/)).toBeNull();
});

it("shows the persisted reply time next to copy only after streaming ends", () => {
  const timestamp = new Date("2026-11-04T13:20:00Z").getTime();
  const reply: TimelineItem = {
    id: "reply",
    kind: "message",
    role: "assistant",
    text: "回复内容",
    createdAt: timestamp,
    streaming: true,
  };
  useTimelineStore.setState({ items: [reply] });
  const view = render(<Timeline />);
  expect(view.container.querySelector("time")).toBeNull();
  expect(screen.queryByRole("button", { name: "复制答复" })).toBeNull();
  act(() => useTimelineStore.setState({ items: [{ ...reply, streaming: false }] }));
  const copy = screen.getByRole("button", { name: "复制答复" });
  const time = copy.nextElementSibling;
  expect(time?.tagName).toBe("TIME");
  expect(time).toHaveAttribute("dateTime", new Date(timestamp).toISOString());
  expect(time?.textContent).toMatch(/^\d{2}:\d{2}$/);
});

it("hides approval history from the conversation while retaining the live approval panel", () => {
  useTimelineStore.setState({
    items: [
      ...base,
      { ...approval, summary: "待批动作" },
      { ...approval, id: "approved", status: "approved", summary: "已批动作" },
      { ...approval, id: "rejected", status: "rejected", summary: "拒绝动作" },
    ],
  });
  render(
    <>
      <Timeline />
      <PendingApproval />
    </>,
  );
  const log = screen.getByRole("log", { name: "会话时间线" });
  expect(within(log).queryByText(/待批动作|已批动作|拒绝动作/)).toBeNull();
  expect(screen.getByRole("region", { name: "待处理审批" })).toHaveTextContent("待批动作");
});
