import type { ServerEvent, TimelineItem } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { applyServerEvent, eventsToTimeline } from "./eventReducer";

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

/** 跑一遍「用户消息 → 终态事件」，返回终态后的用户消息项。 */
function finishTurn(terminalPayload: Record<string, unknown>): TimelineItem {
  const items = eventsToTimeline([
    event("user.message", { turnId: "trn_1", text: "go" }),
    event("turn.completed", { turnId: "trn_1", state: "budget", ...terminalPayload }),
  ]);
  const user = items.find((item) => item.kind === "message" && item.role === "user");
  if (user === undefined) throw new Error("expected a user message item");
  return user;
}

describe("eventReducer budgetCause", () => {
  it("stores a whitelisted budget cause on the user message", () => {
    expect(finishTurn({ terminalReason: "budget", budgetCause: "tokens" })).toMatchObject({
      kind: "message",
      role: "user",
      turnOutcome: "completed",
      terminalReason: "budget",
      budgetCause: "tokens",
    });
  });

  it("accepts every declared cause", () => {
    for (const cause of ["tokens", "context", "duration", "steps", "tool_calls"] as const) {
      expect(finishTurn({ terminalReason: "budget", budgetCause: cause })).toMatchObject({
        budgetCause: cause,
      });
    }
  });

  it("drops an unknown cause instead of trusting the payload", () => {
    const user = finishTurn({ terminalReason: "budget", budgetCause: "unlimited_money" });
    expect(user).toMatchObject({ terminalReason: "budget" });
    expect((user as { budgetCause?: string }).budgetCause).toBeUndefined();
  });

  it("drops a non-string cause and leaves legacy turns untouched", () => {
    const numeric = finishTurn({ terminalReason: "budget", budgetCause: 42 });
    expect((numeric as { budgetCause?: string }).budgetCause).toBeUndefined();

    // 旧服务端不发送 budgetCause：不应凭空补一个，界面回落到原文案。
    const legacy = finishTurn({ terminalReason: "budget" });
    expect((legacy as { budgetCause?: string }).budgetCause).toBeUndefined();
    expect(legacy).toMatchObject({ terminalReason: "budget" });
  });

  it("does not leak a stale cause across turns", () => {
    let items = eventsToTimeline([
      event("user.message", { turnId: "trn_1", text: "first" }),
      event("turn.completed", {
        turnId: "trn_1",
        terminalReason: "budget",
        budgetCause: "tokens",
      }),
      event("user.message", { turnId: "trn_2", text: "second" }),
      event("turn.completed", { turnId: "trn_2", terminalReason: "normal" }),
    ]);

    const first = items.find(
      (item) => item.kind === "message" && item.role === "user" && item.turnId === "trn_1",
    );
    const second = items.find(
      (item) => item.kind === "message" && item.role === "user" && item.turnId === "trn_2",
    );

    expect(first).toMatchObject({ budgetCause: "tokens" });
    expect((second as { budgetCause?: string }).budgetCause).toBeUndefined();

    // 再来一轮，确认前一轮的值不会粘到新的一轮上。
    items = applyServerEvent(items, event("user.message", { turnId: "trn_3", text: "third" }));
    items = applyServerEvent(
      items,
      event("turn.completed", { turnId: "trn_3", terminalReason: "normal" }),
    );
    const third = items.find(
      (item) => item.kind === "message" && item.role === "user" && item.turnId === "trn_3",
    );
    expect((third as { budgetCause?: string }).budgetCause).toBeUndefined();
  });
});
