import { describe, expect, it } from "vitest";
import {
  MAX_QUOTED_OPEN_STEPS,
  PLAN_STALE_TOOL_CALLS,
  type PlanReminderStep,
  stalePlanReminder,
} from "../../src/modules/agent/turn/planReminder.js";

const steps: PlanReminderStep[] = [
  { id: "inspect", title: "检查代码", status: "running" },
  { id: "verify", title: "运行验证", status: "pending" },
];

describe("stale plan reminder", () => {
  it("stays silent while the plan is still fresh", () => {
    expect(
      stalePlanReminder({
        steps,
        toolCallsSincePlanUpdate: PLAN_STALE_TOOL_CALLS - 1,
        alreadyReminded: false,
      }),
    ).toBeNull();
  });

  it("asks for one step-level update once the plan went stale", () => {
    const text = stalePlanReminder({
      steps,
      toolCallsSincePlanUpdate: PLAN_STALE_TOOL_CALLS,
      alreadyReminded: false,
    });

    expect(text).not.toBeNull();
    expect(text).toContain("update_plan");
    expect(text).toContain("inspect: 检查代码");
    expect(text).toContain("running");
    expect(text).toContain(String(PLAN_STALE_TOOL_CALLS));
    // The nudge must ask for the update in the same batch as the next call
    // instead of a separate round trip the model would defer to the end.
    expect(text).toContain("same batch");
    expect(text).toContain("verified");
  });

  it("nudges once per plan version instead of on every step", () => {
    expect(
      stalePlanReminder({ steps, toolCallsSincePlanUpdate: 40, alreadyReminded: true }),
    ).toBeNull();
  });

  it("stays silent without a plan or without anything left to update", () => {
    expect(
      stalePlanReminder({ steps: [], toolCallsSincePlanUpdate: 40, alreadyReminded: false }),
    ).toBeNull();
    expect(
      stalePlanReminder({
        steps: [
          { id: "a", title: "A", status: "done" },
          { id: "b", title: "B", status: "failed" },
        ],
        toolCallsSincePlanUpdate: 40,
        alreadyReminded: false,
      }),
    ).toBeNull();
  });

  it("prefers the running step and bounds how many steps it quotes", () => {
    const many: PlanReminderStep[] = Array.from({ length: 12 }, (_, index) => ({
      id: `s${index}`,
      title: `步骤${index}`,
      status: index === 3 ? "running" : "pending",
    }));
    const text = stalePlanReminder({
      steps: many,
      toolCallsSincePlanUpdate: 9,
      alreadyReminded: false,
    });

    expect(text).toContain("s3: 步骤3");
    expect(text).toContain("+7 more");
    expect(text).not.toContain("步骤5");
    expect(text?.length).toBeLessThan(1_200);
    expect(
      stalePlanReminder({
        steps: many,
        toolCallsSincePlanUpdate: 9,
        alreadyReminded: false,
        threshold: 0,
      }),
    ).toBeNull();
    expect(MAX_QUOTED_OPEN_STEPS).toBe(5);
  });
});
