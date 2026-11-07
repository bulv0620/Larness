import type { ScheduledJobDto, ScheduledJobRunDto, ScheduledJobSchedule } from "@larness/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Logger } from "pino";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import {
  type ScheduledJobRow,
  type ScheduledJobRunRow,
  scheduledJobRuns,
  scheduledJobs,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { publishJobsChanged } from "../../ws/publisher.js";
import { getProjectById } from "../projects/repository.js";
import { ensureDefaultWorkspace } from "../workspaces/default.js";
import { jobById, runById, trimRunsForJob } from "./repository.js";
import { nextRunAfter, scheduleFromRow } from "./schedule.js";
import { runScript, type ScriptRunResult } from "./scriptRunner.js";

const DEFAULT_TICK_MS = 1_000;
const DEFAULT_MAX_CONCURRENT = 2;
const RUN_RETENTION = 200;
const RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface JobRuntimeOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
  logger?: Pick<Logger, "info" | "warn" | "error">;
  enabled?: boolean;
  tickMs?: number;
  maxConcurrent?: number;
  scriptRunner?: (input: Parameters<typeof runScript>[0]) => Promise<ScriptRunResult>;
}

function failedResult(message: string): ScriptRunResult {
  return {
    status: "failed",
    exitCode: null,
    output: "",
    truncated: false,
    errorCode: "JOB_SCRIPT_FAILED",
    errorMessage: message,
  };
}

export class JobRuntime {
  readonly #db: Database;
  readonly #dataDir: string;
  readonly #now: () => number;
  readonly #logger: JobRuntimeOptions["logger"];
  readonly #enabled: boolean;
  readonly #tickMs: number;
  readonly #maxConcurrent: number;
  readonly #scriptRunner: NonNullable<JobRuntimeOptions["scriptRunner"]>;
  readonly #queue: string[] = [];
  readonly #controllers = new Map<string, AbortController>();
  readonly #tasks = new Set<Promise<void>>();
  #timer: NodeJS.Timeout | null = null;
  #ticking = false;
  #stopped = false;

  constructor(options: JobRuntimeOptions) {
    this.#db = options.db;
    this.#dataDir = options.dataDir;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger;
    this.#enabled = options.enabled ?? true;
    this.#tickMs = Math.max(options.tickMs ?? DEFAULT_TICK_MS, 250);
    this.#maxConcurrent = Math.max(1, Math.min(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT, 4));
    this.#scriptRunner = options.scriptRunner ?? runScript;
  }

  start(): void {
    if (this.#stopped) {
      return;
    }

    this.#recover();
    this.#refreshEnabledSchedules();
    this.#trimAll();
    this.#timer = setInterval(() => void this.tick(), this.#tickMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }

    for (const controller of this.#controllers.values()) {
      controller.abort();
    }

    const now = this.#now();
    this.#db
      .update(scheduledJobRuns)
      .set({
        status: "cancelled",
        endedAt: now,
        errorCode: "JOB_RUN_CANCELLED",
        errorMessage: "Larness 关闭，运行已取消",
      })
      .where(eq(scheduledJobRuns.status, "queued"))
      .run();
    this.#queue.length = 0;

    const tasks = [...this.#tasks];
    if (tasks.length === 0) {
      return;
    }

    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        timer.unref?.();
      }),
    ]);
  }

  enqueue(runId: string): void {
    if (this.#stopped || this.#queue.includes(runId) || this.#controllers.has(runId)) {
      return;
    }

    this.#queue.push(runId);
    this.#pump();
  }

  cancel(runId: string): boolean {
    const index = this.#queue.indexOf(runId);
    if (index !== -1) {
      this.#queue.splice(index, 1);
      const now = this.#now();
      const run = runById(this.#db, runId);
      if (run !== null && run.status === "queued") {
        this.#db
          .update(scheduledJobRuns)
          .set({
            status: "cancelled",
            endedAt: now,
            durationMs: 0,
            errorCode: "JOB_RUN_CANCELLED",
            errorMessage: "运行已取消",
          })
          .where(eq(scheduledJobRuns.id, runId))
          .run();
        this.#updateJobLastStatus(run.jobId, "cancelled");
        publishJobsChanged();
      }
      return true;
    }

    const controller = this.#controllers.get(runId);
    if (controller === undefined) {
      return false;
    }

    controller.abort();
    return true;
  }

  isRunning(runId: string): boolean {
    return this.#controllers.has(runId) || this.#queue.includes(runId);
  }

  async tick(): Promise<void> {
    if (this.#stopped || !this.#enabled || this.#ticking) {
      return;
    }

    this.#ticking = true;
    try {
      const now = this.#now();
      const due = this.#db
        .select()
        .from(scheduledJobs)
        .where(
          and(
            eq(scheduledJobs.enabled, true),
            sql`${scheduledJobs.archivedAt} IS NULL`,
            sql`${scheduledJobs.nextRunAt} IS NOT NULL`,
            sql`${scheduledJobs.nextRunAt} <= ${now}`,
          ),
        )
        .orderBy(sql`${scheduledJobs.nextRunAt} ASC`)
        .limit(20)
        .all();

      for (const job of due) {
        this.#claim(job, now);
      }
    } catch (error) {
      this.#logger?.error({ err: error }, "job scheduler tick failed");
    } finally {
      this.#ticking = false;
    }
  }

  #recover(): void {
    const now = this.#now();
    const interrupted = this.#db
      .update(scheduledJobRuns)
      .set({
        status: "interrupted",
        endedAt: now,
        errorCode: "JOB_INTERRUPTED",
        errorMessage: "Larness 重启，运行已中断",
      })
      .where(inArray(scheduledJobRuns.status, ["queued", "running"]))
      .run();

    if ((interrupted.changes ?? 0) > 0) {
      this.#logger?.warn({ count: interrupted.changes }, "marked interrupted job runs");
    }
  }

  #refreshEnabledSchedules(): void {
    const now = this.#now();
    const jobs = this.#db
      .select()
      .from(scheduledJobs)
      .where(and(eq(scheduledJobs.enabled, true), sql`${scheduledJobs.archivedAt} IS NULL`))
      .all();

    for (const job of jobs) {
      try {
        const schedule = this.#scheduleOf(job);
        if (job.nextRunAt === null || job.nextRunAt <= now) {
          if (job.nextRunAt !== null && job.missedPolicy === "run_once") {
            this.#createRun(job, job.nextRunAt, "catch_up");
          }
          this.#db
            .update(scheduledJobs)
            .set({ nextRunAt: nextRunAfter(schedule, now) })
            .where(eq(scheduledJobs.id, job.id))
            .run();
        }
      } catch (error) {
        this.#logger?.warn(
          { err: error, jobId: job.id },
          "disabled invalid scheduled job schedule",
        );
        this.#db
          .update(scheduledJobs)
          .set({ enabled: false, nextRunAt: null })
          .where(eq(scheduledJobs.id, job.id))
          .run();
      }
    }
  }

  #trimAll(): void {
    const now = this.#now();
    const jobs = this.#db.select({ id: scheduledJobs.id }).from(scheduledJobs).all();
    for (const job of jobs) {
      trimRunsForJob(this.#db, job.id, {
        keep: RUN_RETENTION,
        olderThan: now - RUN_RETENTION_MS,
      });
    }
  }

  #claim(job: ScheduledJobRow, now: number): void {
    try {
      const result = immediateTransaction(this.#db, (tx) => {
        const current = jobById(tx, job.id);
        if (
          current === null ||
          !current.enabled ||
          current.archivedAt !== null ||
          current.nextRunAt === null ||
          current.nextRunAt > now
        ) {
          return null;
        }

        const schedule = this.#scheduleOf(current);
        const scheduledFor = current.nextRunAt;
        const active = tx
          .select({ id: scheduledJobRuns.id })
          .from(scheduledJobRuns)
          .where(
            and(
              eq(scheduledJobRuns.jobId, current.id),
              inArray(scheduledJobRuns.status, ["queued", "running"]),
            ),
          )
          .get();

        tx.update(scheduledJobs)
          .set({
            nextRunAt: this.#nextFuture(schedule, scheduledFor, now),
            lastRunAt: scheduledFor,
          })
          .where(eq(scheduledJobs.id, current.id))
          .run();

        if (active !== undefined) {
          const run: ScheduledJobRunRow = {
            id: newId("run"),
            jobId: current.id,
            trigger: "scheduled",
            status: "skipped",
            scheduledFor,
            startedAt: null,
            endedAt: now,
            durationMs: 0,
            sessionId: null,
            turnId: null,
            exitCode: null,
            output: null,
            errorCode: "JOB_OVERLAP",
            errorMessage: "上次运行仍在执行，本次触发已跳过",
            createdAt: now,
          };
          tx.insert(scheduledJobRuns).values(run).run();
          return { runId: run.id, queued: false };
        }

        const run: ScheduledJobRunRow = {
          id: newId("run"),
          jobId: current.id,
          trigger: "scheduled",
          status: "queued",
          scheduledFor,
          startedAt: null,
          endedAt: null,
          durationMs: null,
          sessionId: null,
          turnId: null,
          exitCode: null,
          output: null,
          errorCode: null,
          errorMessage: null,
          createdAt: now,
        };
        tx.insert(scheduledJobRuns).values(run).run();
        return { runId: run.id, queued: true };
      });

      if (result?.queued === true) {
        this.enqueue(result.runId);
      }
      publishJobsChanged();
    } catch (error) {
      this.#logger?.error({ err: error, jobId: job.id }, "failed to claim scheduled job");
    }
  }

  #nextFuture(schedule: ScheduledJobSchedule, scheduledFor: number, now: number): number {
    let next = nextRunAfter(schedule, scheduledFor);
    for (let index = 0; index < 1_000 && next <= now; index++) {
      next = nextRunAfter(schedule, next);
    }
    return next;
  }

  #createRun(job: ScheduledJobRow, scheduledFor: number, trigger: "catch_up"): void {
    const now = this.#now();
    const run: ScheduledJobRunRow = {
      id: newId("run"),
      jobId: job.id,
      trigger,
      status: "queued",
      scheduledFor,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      sessionId: null,
      turnId: null,
      exitCode: null,
      output: null,
      errorCode: null,
      errorMessage: null,
      createdAt: now,
    };
    this.#db.insert(scheduledJobRuns).values(run).run();
    this.enqueue(run.id);
    publishJobsChanged();
  }

  #pump(): void {
    while (
      !this.#stopped &&
      this.#controllers.size < this.#maxConcurrent &&
      this.#queue.length > 0
    ) {
      const runId = this.#queue.shift();
      if (runId === undefined) {
        return;
      }

      const task = this.#execute(runId).finally(() => {
        this.#tasks.delete(task);
        this.#pump();
      });
      this.#tasks.add(task);
    }
  }

  async #execute(runId: string): Promise<void> {
    const run = runById(this.#db, runId);
    if (run === null || run.status !== "queued") {
      return;
    }

    const job = jobById(this.#db, run.jobId);
    if (job === null || job.archivedAt !== null) {
      this.#finalize(run, null, {
        status: "cancelled",
        exitCode: null,
        output: "",
        truncated: false,
        errorCode: "JOB_RUN_CANCELLED",
        errorMessage: "任务已归档",
      });
      return;
    }

    const startedAt = this.#now();
    this.#db
      .update(scheduledJobRuns)
      .set({ status: "running", startedAt, sessionId: job.sessionId ?? null })
      .where(eq(scheduledJobRuns.id, runId))
      .run();
    publishJobsChanged();

    const controller = new AbortController();
    this.#controllers.set(runId, controller);

    let result: ScriptRunResult;
    try {
      const cwd = await this.#cwdFor(job);
      if (job.kind !== "script" || job.scriptSource === null) {
        result = failedResult("Agent 定时任务尚未启用");
      } else {
        result = await this.#scriptRunner({
          dataDir: this.#dataDir,
          jobId: job.id,
          runId,
          source: job.scriptSource,
          cwd,
          timezone: job.timezone,
          timeoutMs: job.timeoutSeconds * 1000,
          signal: controller.signal,
        });
      }
    } catch (error) {
      this.#logger?.error({ err: error, jobId: job.id, runId }, "job execution failed");
      result = failedResult(error instanceof Error ? error.message : "任务执行失败");
    } finally {
      this.#controllers.delete(runId);
    }

    this.#finalize({ ...run, startedAt }, job, result);
  }

  async #cwdFor(job: ScheduledJobRow): Promise<string> {
    if (job.projectId === null) {
      return ensureDefaultWorkspace(this.#dataDir);
    }

    const project = getProjectById(this.#db, job.projectId);
    if (project === null) {
      throw new Error("任务所属项目不存在");
    }

    return project.realPath;
  }

  #finalize(run: ScheduledJobRunRow, job: ScheduledJobRow | null, result: ScriptRunResult): void {
    const endedAt = this.#now();
    const startedAt = run.startedAt ?? endedAt;
    this.#db
      .update(scheduledJobRuns)
      .set({
        status: result.status,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        exitCode: result.exitCode,
        output: result.output,
        errorCode: result.errorCode,
        errorMessage: result.errorMessage,
      })
      .where(eq(scheduledJobRuns.id, run.id))
      .run();

    if (job !== null) {
      this.#db
        .update(scheduledJobs)
        .set({ lastStatus: result.status, lastRunAt: startedAt, updatedAt: endedAt })
        .where(eq(scheduledJobs.id, job.id))
        .run();
      trimRunsForJob(this.#db, job.id, {
        keep: RUN_RETENTION,
        olderThan: endedAt - RUN_RETENTION_MS,
      });
    }

    publishJobsChanged();
  }

  #updateJobLastStatus(jobId: string, status: ScheduledJobRunRow["status"]): void {
    this.#db
      .update(scheduledJobs)
      .set({ lastStatus: status, updatedAt: this.#now() })
      .where(eq(scheduledJobs.id, jobId))
      .run();
  }

  #scheduleOf(job: ScheduledJobRow): ScheduledJobSchedule {
    return scheduleFromRow(job);
  }
}

export function jobDto(row: ScheduledJobRow): ScheduledJobDto {
  const schedule = scheduleFromRow(row);
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId,
    kind: row.kind,
    schedule,
    enabled: row.enabled,
    timeoutSeconds: row.timeoutSeconds,
    overlapPolicy: "skip",
    missedPolicy: row.missedPolicy as ScheduledJobDto["missedPolicy"],
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    lastStatus: row.lastStatus ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
    script:
      row.kind === "script" && row.scriptSource !== null ? { source: row.scriptSource } : null,
    agent:
      row.kind === "agent"
        ? {
            prompt: row.agentPrompt ?? "",
            model: row.agentModel,
            credentialProfileId: row.agentCredentialProfileId,
            thinking: row.agentThinking,
            approvalPolicy: row.agentApprovalPolicy ?? "readonly",
            sessionId: row.sessionId,
          }
        : null,
  };
}

export function jobRunDto(row: ScheduledJobRunRow): ScheduledJobRunDto {
  return {
    id: row.id,
    jobId: row.jobId,
    trigger: row.trigger,
    status: row.status,
    scheduledFor: row.scheduledFor,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
    sessionId: row.sessionId,
    turnId: row.turnId,
    exitCode: row.exitCode,
    output: row.output,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
  };
}
