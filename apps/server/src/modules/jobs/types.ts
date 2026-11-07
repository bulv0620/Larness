import type { ScheduledJobRunErrorCode, ScheduledJobRunStatus } from "@larness/shared";

export interface JobExecutionResult {
  status: Extract<
    ScheduledJobRunStatus,
    "succeeded" | "failed" | "timed_out" | "cancelled" | "interrupted"
  >;
  exitCode: number | null;
  output: string;
  truncated: boolean;
  errorCode: ScheduledJobRunErrorCode | null;
  errorMessage: string | null;
  sessionId?: string | null;
  turnId?: string | null;
}
