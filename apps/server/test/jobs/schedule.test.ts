import { describe, expect, it } from "vitest";
import {
  assertValidSchedule,
  nextRunAfter,
  scheduleFromRow,
} from "../../src/modules/jobs/schedule.js";

describe("job schedule", () => {
  it("computes the next cron run in the task timezone", () => {
    const next = nextRunAfter(
      { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
      Date.parse("2026-03-07T23:00:00Z"),
    );

    expect(new Date(next).toISOString()).toBe("2026-03-08T01:00:00.000Z");
  });

  it("shifts a nonexistent spring DST local time to the next valid local time", () => {
    const next = nextRunAfter(
      { type: "cron", expression: "30 2 * * *", timezone: "America/New_York" },
      Date.parse("2026-03-08T00:00:00Z"),
    );

    expect(new Date(next).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("runs a repeated fall DST local time only once", () => {
    const first = nextRunAfter(
      { type: "cron", expression: "30 1 * * *", timezone: "America/New_York" },
      Date.parse("2026-11-01T00:00:00Z"),
    );
    const second = nextRunAfter(
      { type: "cron", expression: "30 1 * * *", timezone: "America/New_York" },
      first,
    );

    expect(new Date(first).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(new Date(second).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });

  it("computes fixed intervals without drift", () => {
    expect(nextRunAfter({ type: "interval", seconds: 300, timezone: "UTC" }, 1_000)).toBe(301_000);
  });

  it("rejects invalid cron, timezone and interval values", () => {
    expect(() =>
      assertValidSchedule({ type: "cron", expression: "not a cron", timezone: "UTC" }),
    ).toThrow(/Invalid cron/);
    expect(() =>
      assertValidSchedule({ type: "cron", expression: "0 9 * * *", timezone: "Mars/Base" }),
    ).toThrow(/Invalid timezone/);
    expect(() => assertValidSchedule({ type: "interval", seconds: 59, timezone: "UTC" })).toThrow(
      /Invalid interval/,
    );
  });

  it("converts a stored row back to a schedule", () => {
    expect(
      scheduleFromRow({
        scheduleType: "interval",
        cronExpression: null,
        intervalSeconds: 60,
        timezone: "UTC",
      }),
    ).toEqual({ type: "interval", seconds: 60, timezone: "UTC" });
  });
});
