import type { ScheduledJobSchedule } from "@larness/shared";
import { CronExpressionParser } from "cron-parser";
import { JobError } from "./errors.js";

const MAX_LOOKAHEAD_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function assertValidSchedule(schedule: ScheduledJobSchedule): void {
  if (!isValidTimezone(schedule.timezone)) {
    throw new JobError("VALIDATION_ERROR", "Invalid timezone", {
      field: "timezone",
      value: schedule.timezone,
    });
  }

  if (schedule.type === "cron") {
    try {
      const parser = CronExpressionParser.parse(schedule.expression, {
        currentDate: new Date(),
        tz: schedule.timezone,
      });
      parser.next().toDate();
    } catch {
      throw new JobError("VALIDATION_ERROR", "Invalid cron expression", {
        field: "schedule.expression",
      });
    }
    return;
  }

  if (!Number.isInteger(schedule.seconds) || schedule.seconds < 60 || schedule.seconds > 604_800) {
    throw new JobError("VALIDATION_ERROR", "Invalid interval", { field: "schedule.seconds" });
  }
}

export function nextRunAfter(schedule: ScheduledJobSchedule, afterMs: number): number {
  if (schedule.type === "interval") {
    return afterMs + schedule.seconds * 1000;
  }

  const parser = CronExpressionParser.parse(schedule.expression, {
    currentDate: new Date(afterMs),
    tz: schedule.timezone,
  });
  const next = parser.next().toDate().getTime();

  if (!Number.isFinite(next) || next <= afterMs || next - afterMs > MAX_LOOKAHEAD_MS) {
    throw new JobError("VALIDATION_ERROR", "Cron expression has no upcoming run", {
      field: "schedule.expression",
    });
  }

  return next;
}

export interface ScheduleRow {
  scheduleType: "cron" | "interval";
  cronExpression: string | null;
  intervalSeconds: number | null;
  timezone: string;
}

export function scheduleFromRow(row: ScheduleRow): ScheduledJobSchedule {
  if (row.scheduleType === "cron") {
    if (row.cronExpression === null) {
      throw new JobError("VALIDATION_ERROR", "Cron expression is missing");
    }

    return { type: "cron", expression: row.cronExpression, timezone: row.timezone };
  }

  if (row.intervalSeconds === null) {
    throw new JobError("VALIDATION_ERROR", "Interval is missing");
  }

  return { type: "interval", seconds: row.intervalSeconds, timezone: row.timezone };
}
