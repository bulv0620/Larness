import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useTimelineStore } from "@/stores/timelineStore";
import { Timeline } from "./Timeline";

vi.mock("@/lib/workspaceApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspaceApi")>()),
  resumeTurn: vi.fn(),
}));

beforeEach(() => {
  useTimelineStore.setState({
    items: [],
    loading: false,
    isStreaming: false,
    activeTurnId: null,
  });
});

const checkpoint = (goal: string, at: number) =>
  `Work state checkpoint (verified facts, observed at ${at}).\n{"goal":"${goal}"}`;

it("labels a context-rollover slice as continuing and does not show its answer as final", () => {
  useTimelineStore.setState({
    isStreaming: false,
    activeTurnId: null,
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "长任务",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "continued",
        durationMs: 60_000,
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "阶段性结论，任务还没结束。",
        createdAt: 2,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByRole("button", { name: /执行过程 · Continuing\.\.\./ })).toBeInTheDocument();
  expect(screen.queryByText(/执行过程 · Completed/)).toBeNull();
  expect(screen.queryByTestId("final-answer-bubble")).toBeNull();
});

it("reads a continued chain from its latest slice, not the budget-stopped first one", () => {
  useTimelineStore.setState({
    isStreaming: true,
    activeTurnId: "t2",
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "重构 todo 页面",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "budget",
        durationMs: 60_000,
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
        id: "p1",
        kind: "plan",
        turnId: "t1",
        title: "第一片计划",
        createdAt: 2,
        steps: [{ id: "read", title: "读取页面", status: "done" }],
      },
      {
        id: "tool1",
        kind: "tool",
        name: "write_file",
        summary: "create docs/report.md",
        args: "",
        status: "done",
        createdAt: 3,
        turnId: "t1",
        resourceTarget: {
          kind: "file",
          scope: { projectId: "project" },
          path: "docs/report.md",
          version: "v1",
        },
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "前半部分已完成。",
        createdAt: 4,
        turnId: "t1",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: checkpoint("重构 todo", 5),
        createdAt: 5,
        turnId: "t2",
      },
      {
        id: "p2",
        kind: "plan",
        turnId: "t2",
        title: "第二片计划",
        createdAt: 6,
        steps: [{ id: "edit", title: "改写样式", status: "running" }],
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "继续改写样式。",
        createdAt: 7,
        turnId: "t2",
        streaming: true,
      },
    ],
  });

  render(<Timeline />);

  // The task reads as one flow, and the checkpoint is never dumped.
  expect(screen.getAllByLabelText("对话轮次")).toHaveLength(1);
  expect(screen.queryByText(/Work state checkpoint/)).toBeNull();
  // The chain is still running, so nothing settle-only may appear yet.
  const runningHeader = screen.getByRole("button", { name: /执行过程 · Generating\.\.\./ });
  // The grouped chain already crossed a slice boundary; the running label says
  // so instead of looking like a fresh start.
  expect(runningHeader).toHaveAccessibleName(/已自动继续 1 次/);
  expect(screen.queryByRole("region", { name: "本次成果" })).toBeNull();
  expect(screen.queryByTestId("final-answer-bubble")).toBeNull();
  // The first slice's budget stop must not label a running chain.
  expect(screen.queryByRole("button", { name: /预算停止/ })).toBeNull();
  // Each slice publishing its own plan must not stack two plan cards.
  expect(screen.getByRole("button", { name: "计划 · 0/1 · 改写样式" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /第一片计划/ })).toBeNull();
});

it("accumulates the results of every slice in a continued chain", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "整理文档",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "budget",
        durationMs: 60_000,
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
            version: "v1",
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
        turnId: "t1",
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
        turnId: "t1",
        resourceTarget: {
          kind: "file",
          scope: { projectId: "project" },
          path: "tmp/probe.mjs",
          version: "v1",
        },
      },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "报告已成文。",
        createdAt: 4,
        turnId: "t1",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: checkpoint("整理文档", 5),
        createdAt: 5,
        turnId: "t2",
        turnOutcome: "completed",
        durationMs: 30_000,
        fileResultsOmitted: 2,
        fileResults: [
          {
            path: "docs/README.md",
            changeType: "modified",
            version: "v2",
            existed: true,
            category: "deliverable",
          },
        ],
      },
      {
        id: "tool-readme",
        kind: "tool",
        name: "apply_patch",
        summary: "update docs/README.md",
        args: "",
        status: "done",
        createdAt: 6,
        turnId: "t2",
        resourceTarget: {
          kind: "file",
          scope: { projectId: "project" },
          path: "docs/README.md",
          version: "v2",
        },
      },
      {
        id: "a2",
        kind: "message",
        role: "assistant",
        text: "全部完成。",
        createdAt: 7,
        turnId: "t2",
      },
    ],
  });

  render(<Timeline />);

  const results = screen.getByRole("region", { name: "本次成果" });
  // Deliverables from every slice stay listed; process files stay out.
  expect(within(results).getByRole("button", { name: "查看文件 · docs/report.md" })).toBeTruthy();
  expect(within(results).getByRole("button", { name: "查看文件 · docs/README.md" })).toBeTruthy();
  expect(within(results).queryByRole("button", { name: "查看文件 · tmp/probe.mjs" })).toBeNull();
  expect(screen.getByText("另有 2 个文件未列出")).toBeTruthy();
  // The chain reports the summed wall clock and the last slice's outcome.
  expect(screen.getByRole("button", { name: /Completed · 90s/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /预算停止/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^执行过程/ }));
  expect(screen.getByText("报告已成文。")).toBeTruthy();
});

it("names the budget that actually fired instead of a generic stop", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "跑个长任务",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "budget",
        budgetCause: "tokens",
        durationMs: 30_000,
      },
      {
        id: "tool1",
        kind: "tool",
        name: "read_file",
        summary: "read src/app.ts",
        args: "",
        status: "done",
        createdAt: 2,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  // A spend stop is continuable, so the label names the limit that fired.
  expect(screen.getByRole("button", { name: /已达花费上限/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /预算停止/ })).toBeNull();
});

it("keeps the generic wording for turns recorded before the cause existed", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "旧任务",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "budget",
        durationMs: 30_000,
      },
      {
        id: "tool1",
        kind: "tool",
        name: "read_file",
        summary: "read src/app.ts",
        args: "",
        status: "done",
        createdAt: 2,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByRole("button", { name: /预算停止/ })).toBeTruthy();
});

it("names a stall guard instead of hinting at a continuation", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "超时任务",
        createdAt: 1,
        turnId: "t1",
        turnOutcome: "completed",
        terminalReason: "budget",
        budgetCause: "duration",
        durationMs: 3_600_000,
      },
      {
        id: "tool1",
        kind: "tool",
        name: "read_file",
        summary: "read src/app.ts",
        args: "",
        status: "done",
        createdAt: 2,
        turnId: "t1",
      },
    ],
  });

  render(<Timeline />);

  expect(screen.getByRole("button", { name: /执行超时中止/ })).toBeTruthy();
});
