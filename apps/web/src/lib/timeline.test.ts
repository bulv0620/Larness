import type { TimelineItem } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { applyTurnEvent } from "./timeline";

const message: TimelineItem = {
  id: "m1",
  kind: "message",
  role: "assistant",
  text: "",
  streaming: true,
  createdAt: 1,
};

describe("applyTurnEvent", () => {
  it("upserts assistant messages and appends deltas", () => {
    let items: TimelineItem[] = [];
    items = applyTurnEvent(items, { type: "message.assistant", item: message });
    items = applyTurnEvent(items, { type: "message.delta", id: "m1", text: "hello" });
    items = applyTurnEvent(items, { type: "message.delta", id: "m1", text: " world" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ text: "hello world", streaming: true });
  });

  it("updates tools in place", () => {
    let items: TimelineItem[] = [
      {
        id: "t1",
        kind: "tool",
        name: "run_command",
        summary: "pnpm test",
        args: "{}",
        status: "running",
        createdAt: 1,
      },
    ];
    items = applyTurnEvent(items, {
      type: "tool.update",
      id: "t1",
      patch: { status: "done", durationMs: 120, output: "ok" },
    });
    expect(items[0]).toMatchObject({ status: "done", durationMs: 120, output: "ok" });
  });

  it("replaces plans by id and clears streaming on turn.done", () => {
    let items: TimelineItem[] = [message];
    items = applyTurnEvent(items, {
      type: "plan",
      item: {
        id: "p1",
        kind: "plan",
        title: "Plan",
        createdAt: 1,
        steps: [{ id: "s1", title: "a", status: "running" }],
      },
    });
    items = applyTurnEvent(items, {
      type: "plan",
      item: {
        id: "p1",
        kind: "plan",
        title: "Plan",
        createdAt: 2,
        steps: [{ id: "s1", title: "a", status: "done" }],
      },
    });
    items = applyTurnEvent(items, { type: "turn.done" });
    expect(items.filter((item) => item.kind === "plan")).toHaveLength(1);
    expect(items.find((item) => item.kind === "message")).toMatchObject({
      kind: "message",
      streaming: false,
    });
  });

  it("updates approval decisions", () => {
    let items: TimelineItem[] = [
      {
        id: "a1",
        kind: "approval",
        serviceName: "web-prod",
        port: 8080,
        version: "abc",
        impact: "replace",
        status: "pending",
        createdAt: 1,
      },
    ];
    items = applyTurnEvent(items, {
      type: "approval.update",
      id: "a1",
      status: "approved",
    });
    expect(items[0]).toMatchObject({ kind: "approval", status: "approved" });
  });
});
