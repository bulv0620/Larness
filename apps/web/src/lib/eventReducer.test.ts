import type { ServerEvent } from "@larness/shared";
import { describe, expect, it } from "vitest";
import {
  applyAssistantDelta,
  applyServerEvent,
  eventsToTimeline,
  isTerminalTurnEvent,
} from "./eventReducer";

let sequence = 0;

function event(type: string, payload: Record<string, unknown>): ServerEvent {
  sequence += 1;
  return {
    kind: "event",
    eventId: `evt_${sequence}`,
    protocolVersion: 1,
    topic: "agent",
    streamId: "ses_1",
    sessionId: "ses_1",
    sequence,
    timestamp: 1_000 + sequence,
    type,
    payload,
  };
}

describe("event reducer", () => {
  it("replaces the optimistic user message and upserts assistant messages", () => {
    let items = eventsToTimeline([
      {
        ...event("user.message", { turnId: "trn_1", text: "hello" }),
        eventId: "evt_user",
      },
    ]);
    items = [
      { id: "optimistic_user_1", kind: "message", role: "user", text: "hello", createdAt: 1 },
      ...items,
    ];
    items = applyServerEvent(items, event("user.message", { turnId: "trn_1", text: "hello" }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "message", role: "user", text: "hello" });

    items = applyServerEvent(
      items,
      event("assistant.message", { turnId: "trn_1", messageId: "msg_1", text: "hi" }),
    );
    items = applyServerEvent(
      items,
      event("assistant.message", { turnId: "trn_1", messageId: "msg_1", text: "hi again" }),
    );
    expect(items.filter((item) => item.kind === "message")).toHaveLength(2);
    expect(items.at(-1)).toMatchObject({ id: "msg_1", text: "hi again" });
  });

  it("appends assistant deltas to the same message", () => {
    let items = applyServerEvent([], event("assistant.delta", { turnId: "trn_1", text: "Hel" }));
    items = applyServerEvent(items, event("assistant.delta", { turnId: "trn_1", text: "lo" }));
    expect(items[0]).toMatchObject({ kind: "message", text: "Hello", streaming: true });
  });

  it("tracks a tool call lifecycle", () => {
    let items = applyServerEvent(
      [],
      event("tool.requested", {
        turnId: "trn_1",
        toolCallId: "call_1",
        name: "read_file",
        argsSummary: "read README.md",
      }),
    );
    expect(items[0]).toMatchObject({ kind: "tool", status: "running", name: "read_file" });

    items = applyServerEvent(
      items,
      event("tool.started", { turnId: "trn_1", toolCallId: "call_1", name: "read_file" }),
    );
    items = applyServerEvent(
      items,
      event("tool.completed", {
        turnId: "trn_1",
        toolCallId: "call_1",
        resultSummary: "42 bytes",
        resourceTarget: { kind: "file", scope: { projectId: "prj_1" }, path: "README.md" },
      }),
    );
    expect(items[0]).toMatchObject({
      status: "done",
      output: "42 bytes",
      resourceTarget: { kind: "file", path: "README.md" },
    });

    items = applyServerEvent(
      items,
      event("tool.completed", {
        turnId: "trn_1",
        toolCallId: "call_1",
        resultSummary: "terminal started",
        resourceTarget: {
          kind: "terminal",
          projectId: "prj_1",
          terminalId: "term_00000000-0000-0000-0000-000000000001",
          role: "frontend",
        },
      }),
    );
    expect(items[0]).toMatchObject({
      resourceTarget: {
        kind: "terminal",
        projectId: "prj_1",
        terminalId: "term_00000000-0000-0000-0000-000000000001",
        role: "frontend",
      },
    });

    items = applyServerEvent(
      items,
      event("tool.failed", {
        turnId: "trn_1",
        toolCallId: "call_1",
        errorCode: "VERSION_CONFLICT",
        message: "changed",
      }),
    );
    expect(items[0]).toMatchObject({
      status: "error",
      output: "VERSION_CONFLICT: changed",
    });
  });

  it("tracks tool approvals", () => {
    let items = applyServerEvent(
      [],
      event("tool.approval.required", {
        turnId: "trn_1",
        toolCallId: "call_1",
        approvalId: "apv_1",
        summary: "patch README.md",
        risk: "L1",
        expiresAt: 2_000,
      }),
    );
    expect(items[0]).toMatchObject({
      kind: "approval",
      id: "apv_1",
      status: "pending",
      toolName: undefined,
      summary: "patch README.md",
    });

    items = applyServerEvent(
      items,
      event("tool.approval.resolved", { approvalId: "apv_1", decision: "approved" }),
    );
    expect(items[0]).toMatchObject({ status: "approved" });

    items = applyServerEvent(
      items,
      event("tool.approval.resolved", { approvalId: "apv_1", decision: "denied" }),
    );
    expect(items[0]).toMatchObject({ status: "rejected" });
  });

  it("turns file changes, failures and cancellations into timeline items", () => {
    const items = eventsToTimeline([
      event("file.changed", {
        turnId: "trn_1",
        path: "README.md",
        changeType: "modified",
        version: "abc123",
      }),
      event("turn.failed", {
        turnId: "trn_1",
        errorCode: "PROVIDER_RATE_LIMITED",
        message: "rate limited",
      }),
      event("turn.cancelled", { turnId: "trn_2", reason: "user" }),
    ]);

    expect(items[0]).toMatchObject({ kind: "artifact", title: "已修改 README.md" });
    expect(items[1]).toMatchObject({
      kind: "error",
      message: "PROVIDER_RATE_LIMITED: rate limited",
    });
    expect(items[2]).toMatchObject({ kind: "error", message: "已停止当前执行。" });
    expect(isTerminalTurnEvent(event("turn.completed", { turnId: "trn_1" }))).toBe(true);
    expect(isTerminalTurnEvent(event("tool.completed", {}))).toBe(false);
  });

  it("appends streaming assistant deltas into the final message id", () => {
    let items = applyAssistantDelta([], {
      messageId: "msg_stream",
      text: "hello",
      createdAt: 1_010,
    });
    items = applyAssistantDelta(items, {
      messageId: "msg_stream",
      text: " world",
      createdAt: 1_011,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "msg_stream",
      role: "assistant",
      text: "hello world",
      streaming: true,
    });

    items = applyServerEvent(
      items,
      event("assistant.message", {
        turnId: "trn_1",
        messageId: "msg_stream",
        text: "hello world",
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "msg_stream", text: "hello world" });
    expect(items[0]).not.toHaveProperty("streaming", true);
  });
});

it("replays valid plan replacements and ignores malformed plan events", () => {
  const plan = {
    id: "plan_trn_1",
    kind: "plan",
    title: "修复",
    turnId: "trn_1",
    createdAt: 1,
    steps: [{ id: "a", title: "检查", status: "running" }],
  };
  const items = eventsToTimeline([
    event("plan.updated", { turnId: "trn_1", plan }),
    event("plan.updated", {
      turnId: "trn_1",
      plan: { ...plan, steps: [{ ...plan.steps[0], status: "done" }] },
    }),
    event("plan.updated", { plan: { ...plan, steps: [{ status: "invented" }] } }),
  ]);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ turnId: "trn_1", steps: [{ status: "done" }] });
});

it("keeps identical provider call IDs distinct across turns and restores terminal turn metadata", () => {
  const items = eventsToTimeline([
    event("user.message", { turnId: "t1", text: "first" }),
    event("tool.requested", { turnId: "t1", toolCallId: "same", name: "read_file" }),
    event("tool.completed", { turnId: "t1", toolCallId: "same", resultSummary: "first result" }),
    event("turn.cancelled", { turnId: "t1", durationMs: 2000 }),
    event("user.message", { turnId: "t2", text: "second" }),
    event("tool.requested", { turnId: "t2", toolCallId: "same", name: "read_file" }),
  ]);
  expect(items.filter((item) => item.kind === "tool")).toMatchObject([
    { turnId: "t1", status: "done", output: "first result" },
    { turnId: "t2", status: "running" },
  ]);
  expect(items[0]).toMatchObject({ turnOutcome: "cancelled", durationMs: 2000 });
});
