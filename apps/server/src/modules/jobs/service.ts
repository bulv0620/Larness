import {
  DEFAULT_PROJECT_ID,
  type JobListDto,
  type JobRunListDto,
  type JobsSummaryDto,
  type ScheduledJobInput,
  type ScheduledJobListItemDto,
  type ScheduledJobPatch,
  type ScheduledJobRunDto,
  type ScheduledJobSchedule,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { ScheduledJobRow, ScheduledJobRunRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { getModelDefaultSelection } from "../models/catalog.js";
import { getProjectById } from "../projects/repository.js";
import { createSessionRow, updateSessionRow } from "../sessions/repository.js";
import { defaultWorkspacePath } from "../workspaces/default.js";
import { JobError } from "./errors.js";
import {
  activeRunForJob,
  failedRunCountSince,
  insertJobRow,
  insertRunRow,
  jobById,
  jobCount,
  latestRunForJob,
  listJobRows,
  listRunRows,
  runById,
  runningRunCount,
  updateJobRow,
  updateRunRow,
} from "./repository.js";
import { jobDto, jobRunDto } from "./runtime.js";
import { assertValidSchedule, nextRunAfter, scheduleFromRow } from "./schedule.js";

const MAX_JOBS = 100;
const MANUAL_RUN_INTERVAL_MS = 10_000;
const MAX_RUNS_PER_PAGE = 100;

export interface JobControl {
  enqueue(runId: string): void;
  cancel(runId: string): boolean;
  isRunning(runId: string): boolean;
}

export interface JobServiceOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
  control?: JobControl;
}

export class JobService {
  readonly #db: Database;
  readonly #dataDir: string;
  readonly #now: () => number;
  readonly #control: JobControl | undefined;
  readonly #manualRuns = new Map<string, number>();

  constructor(options: JobServiceOptions) {
    this.#db = options.db;
    this.#dataDir = options.dataDir;
    this.#now = options.now ?? Date.now;
    this.#control = options.control;
  }

  list(): JobListDto {
    return {
      items: listJobRows(this.#db).map((row) => {
        const { script: _script, agent: _agent, ...item } = jobDto(row);
        return item satisfies ScheduledJobListItemDto;
      }),
    };
  }

  get(id: string) {
    const row = jobById(this.#db, id);
    if (row === null || row.archivedAt !== null) {
      throw new JobError("NOT_FOUND", "Job not found");
    }
    return jobDto(row);
  }

  summary(): JobsSummaryDto {
    const rows = listJobRows(this.#db);
    return {
      total: rows.length,
      enabled: rows.filter((row) => row.enabled).length,
      running: runningRunCount(this.#db),
      failedLast24h: failedRunCountSince(this.#db, this.#now() - 24 * 60 * 60 * 1000),
    };
  }

  create(input: ScheduledJobInput, clientSessionId?: string) {
    const now = this.#now();
    if (jobCount(this.#db) >= MAX_JOBS) {
      throw new JobError("VALIDATION_ERROR", "Too many jobs", { limit: MAX_JOBS });
    }

    const projectId = this.#normalizeProjectId(input.projectId);
    assertValidSchedule(input.schedule);
    const project = projectId === null ? null : getProjectById(this.#db, projectId);
    if (projectId !== null && project === null) {
      throw new JobError("VALIDATION_ERROR", "Project not found", { field: "projectId" });
    }

    const agent = input.kind === "agent" ? input.agent : null;
    const sessionId = agent === null ? null : newId("ses");
    const row: ScheduledJobRow = {
      id: newId("job"),
      name: input.name,
      projectId,
      kind: input.kind,
      scheduleType: input.schedule.type,
      cronExpression: input.schedule.type === "cron" ? input.schedule.expression : null,
      intervalSeconds: input.schedule.type === "interval" ? input.schedule.seconds : null,
      timezone: input.schedule.timezone,
      enabled: input.enabled,
      overlapPolicy: "skip",
      missedPolicy: input.missedPolicy,
      timeoutSeconds: input.timeoutSeconds,
      scriptSource: input.kind === "script" ? input.script.source : null,
      agentPrompt: agent?.prompt ?? null,
      agentModel: agent?.model ?? null,
      agentCredentialProfileId: agent?.credentialProfileId ?? null,
      agentThinking: agent?.thinking ?? null,
      agentApprovalPolicy: agent?.approvalPolicy ?? null,
      sessionId,
      nextRunAt: input.enabled ? nextRunAfter(input.schedule, now) : null,
      lastRunAt: null,
      lastStatus: null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };

    immediateTransaction(this.#db, (tx) => {
      if (agent !== null && sessionId !== null) {
        const selection = getModelDefaultSelection(tx);
        createSessionRow(tx, {
          id: sessionId,
          projectId,
          workspacePath: project?.realPath ?? defaultWorkspacePath(this.#dataDir),
          title: `自动化 · ${input.name}`,
          modelProfileId: null,
          credentialProfileId: selection?.credentialProfileId ?? null,
          model: selection?.model ?? null,
          thinking: selection?.thinking ?? null,
          approvalPolicyId: agent.approvalPolicy,
          origin: "scheduled",
          now,
        });
      }
      insertJobRow(tx, row);
    });
    appendAudit(this.#db, {
      action: "job.created",
      decision: "info",
      resourceType: "scheduled_job",
      resourceId: row.id,
      clientSessionId,
      details: { kind: row.kind, projectId: row.projectId, scheduleType: row.scheduleType },
      now,
    });
    return jobDto(row);
  }

  update(id: string, patch: ScheduledJobPatch, clientSessionId?: string) {
    const current = jobById(this.#db, id);
    if (current === null || current.archivedAt !== null) {
      throw new JobError("NOT_FOUND", "Job not found");
    }

    if (current.kind === "script" && patch.agent !== undefined) {
      throw new JobError("VALIDATION_ERROR", "Agent settings are not available for a script job");
    }

    if (current.kind === "agent" && patch.script !== undefined) {
      throw new JobError("VALIDATION_ERROR", "Script settings are not available for an Agent job");
    }

    const now = this.#now();
    const schedule: ScheduledJobSchedule = patch.schedule ?? scheduleFromRow(current);
    assertValidSchedule(schedule);
    const enabled = patch.enabled ?? current.enabled;
    const scheduleChanged = patch.schedule !== undefined;
    const nextRunAt =
      enabled === false
        ? null
        : scheduleChanged ||
            current.enabled === false ||
            current.nextRunAt === null ||
            current.nextRunAt <= now
          ? nextRunAfter(schedule, now)
          : current.nextRunAt;

    const next: ScheduledJobRow = {
      ...current,
      name: patch.name ?? current.name,
      scheduleType: schedule.type,
      cronExpression: schedule.type === "cron" ? schedule.expression : null,
      intervalSeconds: schedule.type === "interval" ? schedule.seconds : null,
      timezone: schedule.timezone,
      enabled,
      missedPolicy: patch.missedPolicy ?? current.missedPolicy,
      timeoutSeconds: patch.timeoutSeconds ?? current.timeoutSeconds,
      scriptSource: patch.script?.source ?? current.scriptSource,
      agentPrompt: patch.agent?.prompt ?? current.agentPrompt,
      agentModel: patch.agent?.model === undefined ? current.agentModel : patch.agent.model,
      agentCredentialProfileId:
        patch.agent?.credentialProfileId === undefined
          ? current.agentCredentialProfileId
          : patch.agent.credentialProfileId,
      agentThinking:
        patch.agent?.thinking === undefined ? current.agentThinking : patch.agent.thinking,
      agentApprovalPolicy: patch.agent?.approvalPolicy ?? current.agentApprovalPolicy,
      nextRunAt,
      updatedAt: now,
    };

    immediateTransaction(this.#db, (tx) => {
      updateJobRow(tx, id, next);

      if (current.kind === "agent" && current.sessionId !== null) {
        updateSessionRow(tx, current.sessionId, {
          title: `自动化 · ${next.name}`,
          ...(next.agentApprovalPolicy === null
            ? {}
            : { approvalPolicyId: next.agentApprovalPolicy }),
          updatedAt: now,
        });
      }
    });
    appendAudit(this.#db, {
      action: "job.updated",
      decision: "info",
      resourceType: "scheduled_job",
      resourceId: id,
      clientSessionId,
      details: { enabled, scheduleChanged, scheduleType: next.scheduleType },
      now,
    });
    return jobDto(next);
  }

  archive(id: string, clientSessionId?: string): void {
    const current = jobById(this.#db, id);
    if (current === null || current.archivedAt !== null) {
      throw new JobError("NOT_FOUND", "Job not found");
    }

    const now = this.#now();
    const active = activeRunForJob(this.#db, id);
    updateJobRow(this.#db, id, {
      archivedAt: now,
      enabled: false,
      nextRunAt: null,
      updatedAt: now,
    });

    if (current.kind === "agent" && current.sessionId !== null) {
      updateSessionRow(this.#db, current.sessionId, { status: "archived", updatedAt: now });
    }

    if (active !== null && active.status !== "skipped") {
      if (this.#control?.cancel(active.id)) {
        // The runtime finalizes the run and publishes the change.
      } else {
        updateRunRow(this.#db, active.id, {
          status: "cancelled",
          endedAt: now,
          errorCode: "JOB_RUN_CANCELLED",
          errorMessage: "任务已归档",
        });
      }
    }

    appendAudit(this.#db, {
      action: "job.deleted",
      decision: "info",
      resourceType: "scheduled_job",
      resourceId: id,
      clientSessionId,
      details: { kind: current.kind },
      now,
    });
  }

  runNow(id: string, clientSessionId?: string): ScheduledJobRunDto {
    const job = jobById(this.#db, id);
    if (job === null || job.archivedAt !== null) {
      throw new JobError("NOT_FOUND", "Job not found");
    }

    const now = this.#now();
    if (activeRunForJob(this.#db, id) !== null) {
      throw new JobError("CONFLICT", "Job is already running");
    }

    const last = this.#manualRuns.get(id);
    if (last !== undefined && now - last < MANUAL_RUN_INTERVAL_MS) {
      throw new JobError("RATE_LIMITED", "Manual run is rate limited");
    }

    this.#manualRuns.set(id, now);
    const run: ScheduledJobRunRow = {
      id: newId("run"),
      jobId: id,
      trigger: "manual",
      status: "queued",
      scheduledFor: now,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      sessionId: job.sessionId,
      turnId: null,
      exitCode: null,
      output: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    };
    insertRunRow(this.#db, run);
    updateJobRow(this.#db, id, { lastRunAt: now, updatedAt: now });
    appendAudit(this.#db, {
      action: "job.run_requested",
      decision: "info",
      resourceType: "scheduled_job",
      resourceId: id,
      clientSessionId,
      details: { trigger: "manual", runId: run.id },
      now,
    });
    this.#control?.enqueue(run.id);
    return jobRunDto(run);
  }

  cancelRun(runId: string, clientSessionId?: string): ScheduledJobRunDto {
    const run = runById(this.#db, runId);
    if (run === null) {
      throw new JobError("NOT_FOUND", "Job run not found");
    }

    if (run.status !== "queued" && run.status !== "running") {
      throw new JobError("CONFLICT", "Job run is not active");
    }

    const now = this.#now();
    if (this.#control?.cancel(runId)) {
      // Runtime updates the run.
    } else {
      updateRunRow(this.#db, runId, {
        status: "cancelled",
        endedAt: now,
        errorCode: "JOB_RUN_CANCELLED",
        errorMessage: "运行已取消",
      });
      updateJobRow(this.#db, run.jobId, { lastStatus: "cancelled", updatedAt: now });
    }

    appendAudit(this.#db, {
      action: "job.cancelled",
      decision: "info",
      resourceType: "scheduled_job",
      resourceId: run.jobId,
      clientSessionId,
      details: { runId },
      now,
    });

    const updated = runById(this.#db, runId);
    return jobRunDto(updated ?? run);
  }

  listRuns(id: string, options: { limit?: number; cursor?: string } = {}): JobRunListDto {
    const job = jobById(this.#db, id);
    if (job === null || job.archivedAt !== null) {
      throw new JobError("NOT_FOUND", "Job not found");
    }

    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), MAX_RUNS_PER_PAGE);
    const rows = listRunRows(this.#db, id, {
      limit,
      ...(options.cursor ? { cursor: options.cursor } : {}),
    });
    const items = rows.slice(0, limit);
    return {
      items: items.map(jobRunDto),
      nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  getRun(runId: string): ScheduledJobRunDto {
    const run = runById(this.#db, runId);
    if (run === null) {
      throw new JobError("NOT_FOUND", "Job run not found");
    }
    return jobRunDto(run);
  }

  #normalizeProjectId(projectId: string | null): string | null {
    return projectId === DEFAULT_PROJECT_ID ? null : projectId;
  }
}

export function latestRun(jobId: string, db: Database): ScheduledJobRunRow | null {
  return latestRunForJob(db, jobId);
}

export function activeRun(jobId: string, db: Database): ScheduledJobRunRow | null {
  return activeRunForJob(db, jobId);
}
