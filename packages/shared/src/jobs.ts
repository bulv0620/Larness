import { z } from "zod";

export const ScheduledJobKindSchema = z.enum(["script", "agent"]);
export type ScheduledJobKind = z.infer<typeof ScheduledJobKindSchema>;

export const ScheduledJobMissedPolicySchema = z.enum(["skip", "run_once"]);
export type ScheduledJobMissedPolicy = z.infer<typeof ScheduledJobMissedPolicySchema>;

export const ScheduledJobApprovalPolicySchema = z.enum(["readonly", "autonomous"]);
export type ScheduledJobApprovalPolicy = z.infer<typeof ScheduledJobApprovalPolicySchema>;

export const ScheduledJobRunTriggerSchema = z.enum(["scheduled", "manual", "catch_up"]);
export type ScheduledJobRunTrigger = z.infer<typeof ScheduledJobRunTriggerSchema>;

export const ScheduledJobRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "skipped",
]);
export type ScheduledJobRunStatus = z.infer<typeof ScheduledJobRunStatusSchema>;

export const ScheduledJobRunErrorCodeSchema = z.enum([
  "JOB_SCRIPT_FAILED",
  "JOB_TIMEOUT",
  "JOB_RUN_CANCELLED",
  "JOB_AGENT_FAILED",
  "JOB_INTERRUPTED",
  "JOB_OVERLAP",
]);
export type ScheduledJobRunErrorCode = z.infer<typeof ScheduledJobRunErrorCodeSchema>;

const CronExpressionSchema = z
  .string()
  .min(9)
  .max(128)
  .refine((value) => value.trim().split(/\s+/).length === 5, "Cron 必须是 5 字段");

const TimezoneSchema = z.string().min(1).max(64);

export const ScheduledJobScheduleSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("cron"), expression: CronExpressionSchema, timezone: TimezoneSchema })
    .strict(),
  z
    .object({
      type: z.literal("interval"),
      seconds: z.number().int().min(60).max(604_800),
      timezone: TimezoneSchema,
    })
    .strict(),
]);
export type ScheduledJobSchedule = z.infer<typeof ScheduledJobScheduleSchema>;

const BaseJobInput = {
  name: z.string().trim().min(1).max(80),
  projectId: z.string().min(1).max(128).nullable(),
  schedule: ScheduledJobScheduleSchema,
  enabled: z.boolean().default(true),
  timeoutSeconds: z.number().int().min(60).max(3_600).default(600),
  missedPolicy: ScheduledJobMissedPolicySchema.default("skip"),
};

const ScriptJobInputSchema = z
  .object({
    ...BaseJobInput,
    kind: z.literal("script"),
    script: z.object({ source: z.string().min(1).max(65_536) }).strict(),
  })
  .strict();

const AgentJobInputSchema = z
  .object({
    ...BaseJobInput,
    kind: z.literal("agent"),
    agent: z
      .object({
        prompt: z.string().trim().min(1).max(10_240),
        model: z.string().min(1).max(128).nullable().optional(),
        credentialProfileId: z.string().min(1).max(128).nullable().optional(),
        thinking: z.string().min(1).max(32).nullable().optional(),
        approvalPolicy: ScheduledJobApprovalPolicySchema.default("readonly"),
      })
      .strict(),
  })
  .strict();

export const ScheduledJobInputSchema = z.discriminatedUnion("kind", [
  ScriptJobInputSchema,
  AgentJobInputSchema,
]);
export type ScheduledJobInput = z.infer<typeof ScheduledJobInputSchema>;

/** PATCH body: all mutable fields optional; kind/projectId retained from the existing job. */
export const ScheduledJobPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    schedule: ScheduledJobScheduleSchema.optional(),
    timeoutSeconds: z.number().int().min(60).max(3_600).optional(),
    missedPolicy: ScheduledJobMissedPolicySchema.optional(),
    script: z
      .object({ source: z.string().min(1).max(65_536) })
      .strict()
      .optional(),
    agent: z
      .object({
        prompt: z.string().trim().min(1).max(10_240).optional(),
        model: z.string().min(1).max(128).nullable().optional(),
        credentialProfileId: z.string().min(1).max(128).nullable().optional(),
        thinking: z.string().min(1).max(32).nullable().optional(),
        approvalPolicy: ScheduledJobApprovalPolicySchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ScheduledJobPatch = z.infer<typeof ScheduledJobPatchSchema>;

export interface ScheduledJobAgentConfig {
  prompt: string;
  model: string | null;
  credentialProfileId: string | null;
  thinking: string | null;
  approvalPolicy: ScheduledJobApprovalPolicy;
  sessionId: string | null;
}

export interface ScheduledJobDto {
  id: string;
  name: string;
  projectId: string | null;
  kind: ScheduledJobKind;
  schedule: ScheduledJobSchedule;
  enabled: boolean;
  timeoutSeconds: number;
  overlapPolicy: "skip";
  missedPolicy: ScheduledJobMissedPolicy;
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: ScheduledJobRunStatus | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  script: { source: string } | null;
  agent: ScheduledJobAgentConfig | null;
}

export type ScheduledJobListItemDto = Omit<ScheduledJobDto, "script" | "agent">;

export interface ScheduledJobRunDto {
  id: string;
  jobId: string;
  trigger: ScheduledJobRunTrigger;
  status: ScheduledJobRunStatus;
  scheduledFor: number;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number | null;
  sessionId: string | null;
  turnId: string | null;
  exitCode: number | null;
  output: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
}

export interface JobsSummaryDto {
  total: number;
  enabled: number;
  running: number;
  failedLast24h: number;
}

export interface JobRunListDto {
  items: ScheduledJobRunDto[];
  nextCursor: string | null;
}

export interface JobListDto {
  items: ScheduledJobListItemDto[];
}
