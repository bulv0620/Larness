import type { ScheduledJobApprovalPolicy, ScheduledJobRunErrorCode } from "@larness/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import type { TurnTerminalReason } from "../../db/schema.js";
import {
  type ScheduledJobRow,
  type ScheduledJobRunRow,
  type SessionRow,
  turns,
} from "../../db/schema.js";
import { getModelDefaultSelection } from "../models/catalog.js";
import { getProjectById } from "../projects/repository.js";
import { createSessionRow, getSessionById } from "../sessions/repository.js";
import { cancelTurn, createTurn } from "../sessions/turns.js";
import { ensureDefaultWorkspace } from "../workspaces/default.js";
import { updateJobRow } from "./repository.js";
import type { JobExecutionResult } from "./types.js";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "INTERRUPTED"]);
const POLL_MS = 200;
const DEFAULT_CANCEL_GRACE_MS = 10_000;

export interface AgentJobExecutorOptions {
  db: Database;
  dataDir: string;
  now?: () => number;
  enqueue?: (turnId: string, sessionId: string) => void;
  cancelGraceMs?: number;
}

function policy(value: string | null): ScheduledJobApprovalPolicy {
  return value === "autonomous" ? "autonomous" : "readonly";
}



export const JOB_AGENT_INCOMPLETE: ScheduledJobRunErrorCode = "JOB_AGENT_INCOMPLETE";

/**
 * A Turn that stopped on a budget or truncation is not a successful job run.
 * `null` keeps pre-migration rows and genuine completions compatible.
 */
export function incompleteTurnError(
  reason: TurnTerminalReason | null,
): { errorCode: ScheduledJobRunErrorCode; errorMessage: string } | null {
  if (reason === null || reason === "normal") {
    return null;
  }

  const message =
    reason === "budget"
      ? "Agent 任务因预算耗尽提前结束，请复核已完成的部分"
      : reason === "output_truncated"
        ? "Agent 输出被截断，任务未完整完成"
        : reason === "cancelled" || reason === "interrupted"
          ? "Agent 任务未正常结束"
          : "Agent 任务失败";

  return { errorCode: JOB_AGENT_INCOMPLETE, errorMessage: message };
}

function turnError(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { message?: unknown };
    return typeof parsed.message === "string" && parsed.message.length > 0 ? parsed.message : null;
  } catch {
    return null;
  }
}

export class AgentJobExecutor {
  readonly #db: Database;
  readonly #dataDir: string;
  readonly #now: () => number;
  readonly #enqueue: ((turnId: string, sessionId: string) => void) | undefined;
  readonly #cancelGraceMs: number;

  constructor(options: AgentJobExecutorOptions) {
    this.#db = options.db;
    this.#dataDir = options.dataDir;
    this.#now = options.now ?? Date.now;
    this.#enqueue = options.enqueue;
    this.#cancelGraceMs = options.cancelGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  }

  async run(
    job: ScheduledJobRow,
    run: ScheduledJobRunRow,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<JobExecutionResult> {
    const session = await this.#ensureSession(job);

    if (signal.aborted) {
      return {
        status: "cancelled",
        exitCode: null,
        output: "",
        truncated: false,
        errorCode: "JOB_RUN_CANCELLED",
        errorMessage: "运行已取消",
        sessionId: session.id,
        turnId: null,
      };
    }

    if (this.#enqueue === undefined) {
      return {
        status: "failed",
        exitCode: null,
        output: "",
        truncated: false,
        errorCode: "JOB_AGENT_FAILED",
        errorMessage: "Turn runner unavailable",
        sessionId: session.id,
        turnId: null,
      };
    }

    let created: { turnId: string; sessionId: string; status: string };
    try {
      created = createTurn(
        { db: this.#db, now: this.#now },
        {
          sessionId: session.id,
          text: job.agentPrompt ?? "",
          ...(job.agentModel === null ? {} : { model: job.agentModel }),
          ...(job.agentCredentialProfileId === null
            ? {}
            : { credentialProfileId: job.agentCredentialProfileId }),
          ...(job.agentThinking === null ? {} : { thinking: job.agentThinking }),
          idempotencyKey: `job:${run.id}`,
        },
      );
    } catch (error) {
      return {
        status: "failed",
        exitCode: null,
        output: "",
        truncated: false,
        errorCode: "JOB_AGENT_FAILED",
        errorMessage: error instanceof Error ? error.message : "无法创建 Agent Turn",
        sessionId: session.id,
        turnId: null,
      };
    }

    let timedOut = false;
    let cancelled = false;
    let cancelRequested = false;
    let cancelDeadline: number | null = null;

    const requestCancel = () => {
      if (cancelRequested) {
        return;
      }
      cancelRequested = true;
      cancelDeadline = this.#now() + this.#cancelGraceMs;
      try {
        cancelTurn({ db: this.#db, now: this.#now }, { turnId: created.turnId });
      } catch {
        // The Turn may already be terminal.
      }
    };

    const onAbort = () => {
      cancelled = true;
      requestCancel();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      requestCancel();
    }, timeoutMs);
    timer.unref?.();

    try {
      if (
        created.status === "QUEUED" ||
        created.status === "PREPARING" ||
        created.status === "RUNNING"
      ) {
        this.#enqueue(created.turnId, created.sessionId);
      }

      const overallDeadline = this.#now() + timeoutMs + this.#cancelGraceMs;
      let turn = this.#turn(created.turnId);

      while (turn !== null && !TERMINAL_STATUSES.has(turn.status)) {
        if (cancelDeadline !== null && this.#now() > cancelDeadline) {
          break;
        }
        if (this.#now() > overallDeadline) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        turn = this.#turn(created.turnId);
      }

      const final = this.#turn(created.turnId);

      if (final === null) {
        return {
          status: "failed",
          exitCode: null,
          output: "",
          truncated: false,
          errorCode: "JOB_AGENT_FAILED",
          errorMessage: "Agent Turn 不存在",
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      if (timedOut) {
        return {
          status: "timed_out",
          exitCode: null,
          output: "",
          truncated: false,
          errorCode: "JOB_TIMEOUT",
          errorMessage: "Agent 任务执行超时",
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      if (cancelled) {
        return {
          status: "cancelled",
          exitCode: null,
          output: "",
          truncated: false,
          errorCode: "JOB_RUN_CANCELLED",
          errorMessage: "运行已取消",
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      if (final.status === "COMPLETED") {
        const incomplete = incompleteTurnError(final.terminalReason);

        if (incomplete !== null) {
          return {
            status: "failed",
            exitCode: null,
            output: "",
            truncated: false,
            errorCode: incomplete.errorCode,
            errorMessage: incomplete.errorMessage,
            sessionId: session.id,
            turnId: created.turnId,
          };
        }

        return {
          status: "succeeded",
          exitCode: 0,
          output: "",
          truncated: false,
          errorCode: null,
          errorMessage: null,
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      if (final.status === "INTERRUPTED") {
        return {
          status: "interrupted",
          exitCode: null,
          output: "",
          truncated: false,
          errorCode: "JOB_INTERRUPTED",
          errorMessage: "Agent Turn 已中断",
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      if (final.status === "CANCELLED") {
        return {
          status: "cancelled",
          exitCode: null,
          output: "",
          truncated: false,
          errorCode: "JOB_RUN_CANCELLED",
          errorMessage: "运行已取消",
          sessionId: session.id,
          turnId: created.turnId,
        };
      }

      return {
        status: "failed",
        exitCode: null,
        output: "",
        truncated: false,
        errorCode: "JOB_AGENT_FAILED",
        errorMessage: turnError(final.errorJson) ?? `Agent Turn 状态 ${final.status}`,
        sessionId: session.id,
        turnId: created.turnId,
      };
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  #turn(turnId: string) {
    return (
      this.#db
        .select({
          id: turns.id,
          status: turns.status,
          errorJson: turns.errorJson,
          terminalReason: turns.terminalReason,
        })
        .from(turns)
        .where(eq(turns.id, turnId))
        .get() ?? null
    );
  }

  async #ensureSession(job: ScheduledJobRow): Promise<SessionRow> {
    if (job.sessionId !== null) {
      const existing = getSessionById(this.#db, job.sessionId);
      if (existing !== null && existing.status !== "archived") {
        if (job.projectId === null) {
          await ensureDefaultWorkspace(this.#dataDir);
        }
        return existing;
      }
    }

    const project = job.projectId === null ? null : getProjectById(this.#db, job.projectId);
    if (job.projectId !== null && project === null) {
      throw new Error("任务所属项目不存在");
    }

    const workspacePath = project?.realPath ?? (await ensureDefaultWorkspace(this.#dataDir));
    const selection = getModelDefaultSelection(this.#db);
    const session = createSessionRow(this.#db, {
      id: newId("ses"),
      projectId: job.projectId,
      workspacePath,
      title: `自动化 · ${job.name}`,
      modelProfileId: null,
      credentialProfileId: selection?.credentialProfileId ?? null,
      model: selection?.model ?? null,
      thinking: selection?.thinking ?? null,
      approvalPolicyId: policy(job.agentApprovalPolicy),
      origin: "scheduled",
      now: this.#now(),
    });
    updateJobRow(this.#db, job.id, { sessionId: session.id, updatedAt: this.#now() });
    return session;
  }
}
