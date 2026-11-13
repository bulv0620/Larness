import { realpath } from "node:fs/promises";
import {
  type ApprovalPolicy,
  decideToolAccess,
  type ModelMessage,
  type ProviderAdapter,
  ProviderError,
  type ProviderFinishReason,
  type ProviderThinking,
  type ProviderUsage,
  type ToolCallRequest,
  type ToolRegistry,
  type ToolResult,
  type ToolSchema,
} from "@larness/agent";
import { FileManagerError, GitError, OutputRedactor } from "@larness/resources";
import {
  AcquireTerminalControlParamsSchema,
  type AssistantDeltaEvent,
  type AssistantReasoningDeltaEvent,
  CommandParamsSchema,
  FileResultTargetSchema,
  InterruptTerminalParamsSchema,
  PlanParamsSchema,
  type PreviewResultTarget,
  PreviewResultTargetSchema,
  ReadTerminalOutputParamsSchema,
  ReleaseTerminalControlParamsSchema,
  SendTerminalInputParamsSchema,
  type ServerEvent,
  ServiceIdSchema,
  ServiceRegisterInputSchema,
  StopProjectTerminalParamsSchema,
  TerminalDevSchema,
  TerminalResultTargetSchema,
  type TurnFileResult,
} from "@larness/shared";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { SessionRow, TurnRow, TurnStatus, TurnTerminalReason } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { publishAgentEvent } from "../../ws/publisher.js";
import type { CommandManager } from "../commands/manager.js";
import type { GitManager } from "../git/manager.js";
import { listEncryptedSecrets } from "../models/repository.js";
import { getProjectById, updateProjectRow } from "../projects/repository.js";
import { detectGit, parseProjectSettings } from "../projects/service.js";
import type { ServiceManager } from "../services/manager.js";
import { getSessionById, getTurnById, updateTurnRow } from "../sessions/repository.js";
import type { TerminalManager } from "../terminals/manager.js";
import { isDefaultWorkspace } from "../workspaces/default.js";
import { type ApprovalDto, getApproval, invalidateTurnApprovals } from "./approvalService.js";
import { assembleContext } from "./contextAssembler.js";
import { compressContext, shouldCompress } from "./contextCompressor.js";
import { appendAgentEvent, toServerEvent } from "./events.js";
import { buildObservationSnapshot } from "./observationSnapshot.js";
import { ProjectWriteLock } from "./projectWriteLock.js";
import {
  calibrateEstimate,
  contextWatermark,
  estimateRequestTokens,
  reservedOutputTokens,
} from "./tokenEstimator.js";
import { executeTool, type ToolExecutionOutcome } from "./toolExecutor.js";
import { addUsage, DEFAULT_BUDGET, deriveTerminalReason, type TurnBudget } from "./turn/budget.js";
import { createSecretLoader } from "./turn/secrets.js";
import { stableArgsKey, turnInputText } from "./turn/text.js";
import {
  boundedCommandOutput,
  boundedTerminalOutput,
  toolFailureIssues,
  toolMessageContent,
} from "./turn/toolResults.js";
import {
  checkpointMessage,
  latestEventSeq,
  saveTurnCheckpoint,
  TurnFactsBuilder,
} from "./turnCheckpoint.js";
import { collectTurnFileResults, type TurnFileChange } from "./turnResults.js";

function commandDisplay(params: unknown) {
  const command = CommandParamsSchema.parse(params);
  const redact = (value: string) => new OutputRedactor([]).push(value, true);
  let hideNext = false;
  return {
    ...command,
    executable: redact(command.executable),
    cwd: redact(command.cwd),
    args: command.args.map((value) => {
      const hide = hideNext;
      hideNext = /^--?(authorization|api[_-]?key|token|password|cookie|secret)$/i.test(value);
      return hide ? "[Redacted]" : redact(value);
    }),
  };
}

const APPROVAL_POLL_MS = 100;
const CHECKPOINT_MIN_GAIN = 200;

export interface ResolvedProvider {
  adapter: ProviderAdapter;
  model: string;
  apiKey?: string;
  endpoint?: string;
  contextWindow?: number;
  thinking?: ProviderThinking;
}

export type ProviderResolver = (
  session: SessionRow,
  turn: TurnRow,
) => ResolvedProvider | Promise<ResolvedProvider>;

export interface TurnRunnerOptions {
  dataDir?: string;
  db: Database;
  registry: ToolRegistry;
  resolveProvider: ProviderResolver;
  publish?: (event: ServerEvent | AssistantDeltaEvent | AssistantReasoningDeltaEvent) => void;
  now?: () => number;
  budget?: Partial<TurnBudget>;
  approvalPollMs?: number;
  approvalTtlMs?: number;
  lockTtlMs?: number;
  commands?: CommandManager;
  terminals?: TerminalManager;
  git?: GitManager;
  services?: ServiceManager;
  pm2Context?: (projectId: string | null) => Promise<import("@larness/shared").Pm2CommandContext>;
  logger?: TurnTimingLogger;
}

export interface TurnTimingLogger {
  info(fields: Record<string, unknown>, message: string): void;
}

export type TurnBudgetCause = "duration" | "tokens" | "context" | "steps" | "tool_calls";

export type TurnRunResult = {
  status: TurnStatus;
  errorCode?: string;
  terminalReason?: TurnTerminalReason;
  /** Which budget stopped the turn; only spend/context stops are continuable. */
  budgetCause?: TurnBudgetCause;
};

function isTerminal(status: TurnStatus): boolean {
  return (
    status === "COMPLETED" ||
    status === "FAILED" ||
    status === "CANCELLED" ||
    status === "INTERRUPTED"
  );
}

function approvalPolicy(value: string): ApprovalPolicy {
  return value === "strict" || value === "readonly" || value === "autonomous" ? value : "standard";
}

function gitFailure(error: unknown, summary: string): ToolResult {
  const code =
    error instanceof GitError
      ? error.code
      : typeof (error as { code?: unknown } | null)?.code === "string"
        ? ((error as { code: string }).code as string)
        : "TOOL_ERROR";
  return { ok: false, errorCode: code, summary };
}

function terminalFailure(error: unknown, summary: string): ToolResult {
  return {
    ok: false,
    errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
    summary,
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function registeredServiceTarget(
  toolName: string,
  data: unknown,
  projectId: string | null,
): PreviewResultTarget | undefined {
  if (toolName !== "register_temporary_service" || projectId === null) return undefined;
  const parsed = z
    .object({
      serviceId: ServiceIdSchema,
      status: z.string(),
      name: z.string().min(1).max(128).optional(),
    })
    .safeParse(data);
  if (!parsed.success || parsed.data.status !== "RUNNING") return undefined;
  return {
    kind: "preview",
    projectId,
    serviceId: parsed.data.serviceId,
    path: "/",
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
  };
}

export class TurnRunner {
  readonly #options: TurnRunnerOptions;
  readonly #budget: TurnBudget;
  readonly #controllers = new Map<string, AbortController>();

  constructor(options: TurnRunnerOptions) {
    this.#options = options;
    this.#budget = { ...DEFAULT_BUDGET, ...options.budget };
  }

  cancel(turnId: string): boolean {
    const controller = this.#controllers.get(turnId);

    if (controller === undefined) {
      return false;
    }

    controller.abort();
    return true;
  }

  stop(): void {
    for (const controller of this.#controllers.values()) {
      controller.abort();
    }
  }

  activeCount(): number {
    return this.#controllers.size;
  }

  async run(turnId: string): Promise<TurnRunResult> {
    const turn = getTurnById(this.#options.db, turnId);

    if (turn === null) {
      return { status: "FAILED", errorCode: "NOT_FOUND" };
    }

    if (isTerminal(turn.status)) {
      return { status: turn.status };
    }

    const session = getSessionById(this.#options.db, turn.sessionId);

    if (session === null) {
      immediateTransaction(this.#options.db, (tx) => {
        updateTurnRow(tx, turn.id, {
          status: "FAILED",
          endedAt: this.#now(),
          errorJson: JSON.stringify({ code: "NOT_FOUND", message: "session not found" }),
        });
      });
      return { status: "FAILED", errorCode: "NOT_FOUND" };
    }

    if (turn.status === "CANCELLING") {
      return this.#finalize(turn, session, "CANCELLED", {
        eventType: "turn.cancelled",
        reason: "user",
      });
    }

    const controller = new AbortController();
    this.#controllers.set(turnId, controller);
    const startedAt = turn.startedAt ?? this.#now();
    const deadline = startedAt + this.#budget.maxDurationMs;
    // A request must not outlive the turn budget: cancel only stops on demand.
    let deadlineReached = false;
    const deadlineTimer = setTimeout(
      () => {
        deadlineReached = true;
        controller.abort();
      },
      Math.max(0, deadline - this.#now()),
    );
    deadlineTimer.unref?.();
    const project =
      session.projectId === null ? null : getProjectById(this.#options.db, session.projectId);
    let projectRoot = project?.realPath ?? session.workspacePath;
    // Project-configured ignore patterns apply to list/search for the whole Turn.
    const projectIgnore =
      project === null ? undefined : parseProjectSettings(project.settingsJson).ignore;
    // One probe per Turn keeps the snapshot fresh while staying prefix-stable.
    let gitObservation: { detected: boolean; observedAt: number } | undefined;

    if (project !== null) {
      const detected = await detectGit(project.realPath);
      gitObservation = { detected, observedAt: this.#now() };

      // Self-heal the stored flag so the sidebar is not stale after `git init`.
      if (detected !== project.gitDetected) {
        immediateTransaction(this.#options.db, (tx) =>
          updateProjectRow(tx, project.id, {
            gitDetected: detected,
            updatedAt: project.updatedAt,
          }),
        );
      }
    }
    let turnInput: unknown;
    try {
      turnInput = JSON.parse(turn.inputJson);
    } catch {
      turnInput = undefined;
    }
    const execution = z
      .object({
        executionContext: z.object({
          clientSessionId: z.string().min(1),
          policySnapshotId: z.string().min(1),
          policy: z.enum(["standard", "strict", "readonly", "autonomous"]),
        }),
      })
      .safeParse(turnInput);
    const snapshot = execution.success ? execution.data.executionContext : undefined;
    const policy = snapshot?.policy ?? approvalPolicy(session.approvalPolicyId);
    let projectLock: ProjectWriteLock | null = null;
    let usage: ProviderUsage = {};
    let steps = 0;
    let toolCalls = 0;
    let finalized = false;
    const timing = {
      assembleMs: 0,
      summaryMs: 0,
      toolMs: 0,
      firstTokenMs: undefined as number | undefined,
    };
    let anchoredHeuristicTokens: number | undefined;
    let anchoredProviderTokens: number | undefined;
    let wrapUpRequested = false;
    const facts = new TurnFactsBuilder(turnInputText(turn.inputJson));
    // First-touch order survives; later writes only refresh the version.
    const fileChanges = new Map<string, TurnFileChange>();
    const repeatFailures = new Map<string, number>();
    // Failed callIds per (tool, canonical args), so a later identical success can
    // tell the UI which earlier attempts it superseded.
    const failedCalls = new Map<string, string[]>();
    // One secret table read per Turn (D8); plaintext is still decrypted per call.
    const loadSecrets = createSecretLoader(() => listEncryptedSecrets(this.#options.db));

    const finalize = async (
      status: TurnStatus,
      options: {
        eventType: string;
        errorCode?: string;
        message?: string;
        reason?: string;
        budgetExhausted?: boolean;
        budgetCause?: TurnBudgetCause;
        finishReason?: ProviderFinishReason;
      },
    ): Promise<TurnRunResult> => {
      if (lockLost && status === "CANCELLED") {
        status = "FAILED";
        options = {
          eventType: "turn.failed",
          errorCode: "RESOURCE_LOCKED",
          message: "Project write lock was lost",
        };
      }
      const fileResults = await this.#collectFileResults(projectRoot, projectIgnore, fileChanges);
      const omitted = fileChanges.size - fileResults.length;
      finalized = true;
      return this.#finalize(turn, session, status, {
        ...options,
        usage,
        durationMs: this.#now() - startedAt,
        ...(fileResults.length === 0 ? {} : { fileResults }),
        ...(omitted <= 0 ? {} : { fileResultsOmitted: omitted }),
      });
    };

    const checkBudget = (): "ok" | "cancel" | "budget" => {
      if (controller.signal.aborted) {
        return deadlineReached ? "budget" : "cancel";
      }

      const current = getTurnById(this.#options.db, turnId);

      if (current?.status === "CANCELLING") {
        controller.abort();
        return "cancel";
      }

      if (this.#now() - startedAt > this.#budget.maxDurationMs) {
        return "budget";
      }

      return "ok";
    };

    const acquireProjectLock = (): boolean => {
      if (projectLock === null) {
        projectLock = new ProjectWriteLock({
          db: this.#options.db,
          projectId: session.projectId ?? `workspace:${session.id}`,
          rootRealPath: projectRoot,
          owner: session.id,
          executionId: turn.id,
          ttlMs: this.#options.lockTtlMs,
          now: this.#options.now,
        });
      }

      return projectLock.acquire() !== null;
    };

    const renewProjectLock = (): boolean => projectLock === null || projectLock.renewIfHeld();

    let lockLost = false;
    const heartbeat = setInterval(
      () => {
        try {
          if (!renewProjectLock()) throw new Error("Lock lost");
        } catch {
          lockLost = true;
          controller.abort();
        }
      },
      Math.max(10, Math.min(1000, (this.#options.lockTtlMs ?? 30_000) / 3)),
    );
    heartbeat.unref();
    const execute = (request: ToolCallRequest, approvalId?: string) =>
      executeTool(
        { db: this.#options.db, registry: this.#options.registry, now: this.#options.now },
        {
          sessionId: session.id,
          turnId: turn.id,
          toolCallId: request.id,
          toolName: request.name,
          args: request.args,
          policy,
          projectRoot,
          ...(projectIgnore === undefined || projectIgnore.length === 0
            ? {}
            : { ignore: projectIgnore }),
          signal: controller.signal,
          clientSessionId: snapshot?.clientSessionId,
          policySnapshotId: snapshot?.policySnapshotId,
          ...(approvalId ? { approvalId } : {}),
          ...(this.#options.approvalTtlMs === undefined
            ? {}
            : { approvalTtlMs: this.#options.approvalTtlMs }),
          updatePlan: async (params) => {
            const plan = PlanParamsSchema.safeParse(params);
            if (!plan.success)
              return { ok: false, errorCode: "VALIDATION_ERROR", summary: "Invalid plan" };
            if (checkBudget() !== "ok")
              return { ok: false, errorCode: "FORBIDDEN", summary: "Turn no longer active" };
            facts.recordPlan(plan.data.steps);
            this.#emit(turn, session, "plan.updated", {
              turnId: turn.id,
              plan: {
                ...plan.data,
                id: `plan_${turn.id}`,
                kind: "plan",
                turnId: turn.id,
                createdAt: startedAt,
              },
            });
            return { ok: true, summary: "任务计划已更新" };
          },
          runCommand: async (params, assertAuthorized) => {
            if (!snapshot || !this.#options.commands)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Command execution context unavailable",
              };
            try {
              const row = await this.#options.commands.execute(
                {
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  clientSessionId: snapshot.clientSessionId,
                  policySnapshotId: snapshot.policySnapshotId,
                  remainingMs: Math.max(
                    1,
                    Math.floor(this.#budget.maxDurationMs - (this.#now() - startedAt)),
                  ),
                  signal: controller.signal,
                  ...(projectLock?.handle ? { inheritedLock: projectLock.handle } : {}),
                  assertAuthorized: () => {
                    assertAuthorized();
                    if (checkBudget() !== "ok" || lockLost)
                      throw new Error("Execution no longer authorized");
                  },
                  isBudgetExpired: () => deadlineReached,
                  onCreated: (commandId) =>
                    this.#emit(turn, session, "tool.command.created", {
                      turnId: turn.id,
                      toolCallId: request.id,
                      commandId,
                      command: commandDisplay(params),
                    }),
                },
                params,
              );
              const output = await this.#options.commands.output(row.id, 0, 500);
              const completeText = output.chunks.map((chunk) => chunk.data).join("");
              // Keep the tail: test summaries and exit diagnostics live there.
              const bounded = boundedCommandOutput(completeText, 12_000);
              const text = bounded.text;
              const truncated =
                row.truncated ||
                output.truncated ||
                output.resyncRequired ||
                bounded.truncated ||
                output.chunks.length >= 500;
              return {
                ok: row.status === "COMPLETED" && row.exitCode === 0,
                summary: `Command ${row.status}; exit code ${row.exitCode ?? "—"}`,
                errorCode: row.reasonCode ?? undefined,
                truncated,
                data: {
                  commandId: row.id,
                  status: row.status,
                  exitCode: row.exitCode,
                  output: text,
                  truncated,
                },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Command execution failed",
              };
            }
          },
          startTerminal: async (params, assertAuthorized) => {
            const parsed = TerminalDevSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal parameters",
              };
            if (!snapshot || !this.#options.terminals || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const before = await this.#options.terminals.activeDevByRole(
                session.projectId,
                parsed.data.role,
              );
              const row = await this.#options.terminals.createDev(
                {
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  policySnapshotId: snapshot.policySnapshotId,
                  signal: controller.signal,
                  assertAuthorized: () => {
                    assertAuthorized();
                    if (checkBudget() !== "ok" || lockLost)
                      throw new Error("Execution no longer authorized");
                  },
                },
                parsed.data,
              );
              return {
                ok: true,
                summary: `开发终端 ${row.role ?? "dev"} ${row.status}；仅表示终端状态，服务状态请读取输出核对`,
                data: {
                  terminalId: row.id,
                  role: row.role,
                  status: row.status,
                  exitCode: row.exitCode,
                  reused: before?.id === row.id,
                },
              };
            } catch (error) {
              return terminalFailure(error, "Project terminal could not be started");
            }
          },
          readTerminalOutput: async (params) => {
            const parsed = ReadTerminalOutputParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal read parameters",
              };
            if (!this.#options.terminals)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const row = await this.#options.terminals.readSessionTerminal(
                parsed.data.terminalId,
                session.id,
              );
              const page = await this.#options.terminals.readSessionTerminalOutput(
                parsed.data.terminalId,
                session.id,
                parsed.data.after,
                parsed.data.limit,
              );
              const complete = page.chunks.map((chunk) => chunk.data).join("");
              const bounded = boundedTerminalOutput(complete);
              const truncated =
                page.truncated ||
                page.resyncRequired ||
                bounded.truncated ||
                complete !== bounded.text;
              return {
                ok: true,
                summary: `读取终端 ${row.role ?? row.id.slice(-6)} 输出（${page.chunks.length} 块）`,
                truncated,
                data: {
                  terminalId: row.id,
                  role: row.role,
                  status: row.status,
                  output: bounded.text,
                  nextCursor: page.nextCursor,
                  truncated,
                  resyncRequired: page.resyncRequired,
                },
              };
            } catch (error) {
              return terminalFailure(error, "Terminal output could not be read");
            }
          },
          stopTerminal: async (params) => {
            const parsed = StopProjectTerminalParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal stop parameters",
              };
            if (!snapshot || !this.#options.terminals || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const row = await this.#options.terminals.stopProjectDev(
                parsed.data.terminalId,
                session.projectId,
                snapshot.clientSessionId,
              );
              const stopped = row.status === "TERMINATED" || row.status === "EXITED";
              return {
                ok: stopped,
                summary: `项目终端 ${row.role ?? row.id.slice(-6)} ${row.status}`,
                ...(stopped ? {} : { errorCode: row.reasonCode ?? "STOP_UNCONFIRMED" }),
                data: {
                  terminalId: row.id,
                  role: row.role,
                  status: row.status,
                  exitCode: row.exitCode,
                  reasonCode: row.reasonCode,
                },
              };
            } catch (error) {
              return terminalFailure(error, "Project terminal could not be stopped");
            }
          },
          acquireTerminalControl: async (params, assertAuthorized) => {
            const parsed = AcquireTerminalControlParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal control parameters",
              };
            if (!snapshot || !this.#options.terminals)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const row = await this.#options.terminals.acquireAgent(parsed.data.terminalId, {
                clientSessionId: snapshot.clientSessionId,
                projectId: session.projectId,
                sessionId: session.id,
                turnId: turn.id,
                toolCallId: request.id,
                signal: controller.signal,
                assertAuthorized: () => {
                  assertAuthorized();
                  if (checkBudget() !== "ok" || lockLost)
                    throw new Error("Execution no longer authorized");
                },
              });
              return {
                ok: true,
                summary: `终端 ${row.role ?? row.id.slice(-6)} 控制权已获取`,
                data: {
                  terminalId: row.id,
                  role: row.role,
                  generation: row.lease?.generation ?? null,
                  expiresAt: row.lease?.expiresAt ?? null,
                  ownerType: row.lease?.ownerType ?? null,
                },
              };
            } catch (error) {
              return terminalFailure(error, "Terminal control could not be acquired");
            }
          },
          sendTerminalInput: async (params) => {
            const parsed = SendTerminalInputParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal input parameters",
              };
            if (!snapshot || !this.#options.terminals)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const result = await this.#options.terminals.inputAgent(
                parsed.data.terminalId,
                {
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  signal: controller.signal,
                },
                parsed.data.leaseGeneration,
                parsed.data.inputSequence,
                parsed.data.data,
              );
              return {
                ok: true,
                summary: result.accepted
                  ? `已向终端发送 ${Buffer.byteLength(parsed.data.data)} 字节输入`
                  : `输入序号 ${result.inputSequence} 已处理，未重复发送`,
                data: { terminalId: parsed.data.terminalId, ...result },
              };
            } catch (error) {
              return terminalFailure(error, "Terminal input could not be sent");
            }
          },
          interruptTerminal: async (params) => {
            const parsed = InterruptTerminalParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal interrupt parameters",
              };
            if (!snapshot || !this.#options.terminals)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const result = await this.#options.terminals.interruptAgent(
                parsed.data.terminalId,
                {
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  signal: controller.signal,
                },
                parsed.data.leaseGeneration,
              );
              return {
                ok: true,
                summary: "终端中断已发送；未确认进程退出，请重读输出 / 状态",
                data: { terminalId: parsed.data.terminalId, ...result },
              };
            } catch (error) {
              return terminalFailure(error, "Terminal interrupt could not be sent");
            }
          },
          releaseTerminalControl: async (params) => {
            const parsed = ReleaseTerminalControlParamsSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid terminal release parameters",
              };
            if (!snapshot || !this.#options.terminals)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Project terminal context unavailable",
              };
            try {
              const row = await this.#options.terminals.releaseAgent(
                parsed.data.terminalId,
                {
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  signal: controller.signal,
                },
                parsed.data.leaseGeneration,
              );
              return {
                ok: true,
                summary: `终端 ${row.role ?? row.id.slice(-6)} 控制权已释放`,
                data: { terminalId: row.id, role: row.role, status: row.status },
              };
            } catch (error) {
              return terminalFailure(error, "Terminal control could not be released");
            }
          },
          gitRead: async (operation, params) => {
            if (!this.#options.git || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Git context unavailable",
              };
            try {
              if (operation === "status") {
                const result = await this.#options.git.status(session.projectId);
                return {
                  ok: true,
                  summary: `Git ${result.branch}${result.ahead || result.behind ? ` (+${result.ahead}/-${result.behind})` : ""}`,
                  data: result,
                };
              }
              if (operation === "diff") {
                const parsed = params as { path: string; staged?: boolean };
                const result = await this.#options.git.diff(
                  session.projectId,
                  parsed.path,
                  parsed.staged === true,
                );
                return {
                  ok: true,
                  summary: `Git diff ${result.path}${result.staged ? " (staged)" : ""}${result.truncated ? " (truncated)" : ""}`,
                  truncated: result.truncated,
                  data: result,
                };
              }
              if (operation === "log") {
                const parsed = params as { limit?: number; cursor?: number };
                const result = await this.#options.git.log(
                  session.projectId,
                  parsed.limit ?? 50,
                  parsed.cursor ?? 0,
                );
                return { ok: true, summary: `${result.length} commits`, data: { items: result } };
              }
              const parsed = params as { limit?: number; cursor?: number };
              const result = await this.#options.git.branches(
                session.projectId,
                parsed.limit ?? 100,
                parsed.cursor ?? 0,
              );
              return { ok: true, summary: `${result.length} branches`, data: { items: result } };
            } catch (error) {
              return gitFailure(error, "Git query failed");
            }
          },
          registerService: async (params, assertAuthorized) => {
            const parsed = ServiceRegisterInputSchema.safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid service registration",
              };
            if (!snapshot || !this.#options.services || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service context unavailable",
              };
            try {
              assertAuthorized();
              if (checkBudget() !== "ok" || lockLost)
                throw new Error("Execution no longer authorized");
              const service = await this.#options.services.registerAgent(
                {
                  ...parsed.data,
                  projectId: session.projectId,
                  operationKey: `${turn.id}:${request.id}`,
                  sourceSessionId: session.id,
                },
                snapshot.clientSessionId,
              );
              return {
                ok: true,
                summary: `临时服务 ${service.name} ${service.status}`,
                data: {
                  serviceId: service.id,
                  kind: service.kind,
                  projectId: service.projectId,
                  name: service.name,
                  status: service.status,
                  terminalId: service.terminalId,
                  endpoint: service.endpoint,
                  previewEligible: service.previewEligible,
                },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Service registration failed",
              };
            }
          },
          resolveServicePreview: async (params) => {
            const parsed = z
              .object({
                serviceId: ServiceIdSchema,
                path: z.string().min(1).max(2048).default("/"),
              })
              .strict()
              .safeParse(params);
            if (!parsed.success)
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid preview target",
              };
            if (!this.#options.services || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service context unavailable",
              };
            try {
              const service = this.#options.services.get(parsed.data.serviceId);
              if (service.projectId !== session.projectId)
                return { ok: false, errorCode: "FORBIDDEN", summary: "Service is not accessible" };
              if (service.status !== "RUNNING")
                return {
                  ok: false,
                  errorCode: "PREVIEW_UNAVAILABLE",
                  summary: "Service is not running",
                };
              return {
                ok: true,
                summary: `预览 ${service.name}${parsed.data.path}`,
                data: {
                  kind: "preview",
                  projectId: session.projectId,
                  serviceId: service.id,
                  path: parsed.data.path,
                },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Preview target unavailable",
              };
            }
          },
          listServices: async (params) => {
            if (!this.#options.services || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service context unavailable",
              };
            try {
              const limit =
                typeof params === "object" && params !== null && "limit" in params
                  ? Number(params.limit)
                  : 50;
              const result = this.#options.services.list({
                projectId: session.projectId,
                limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50,
              });
              return {
                ok: true,
                summary: `${result.items.length} 个临时服务`,
                data: result,
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Service list failed",
              };
            }
          },
          gitAction: async (params, assertAuthorized) => {
            if (!this.#options.git || !session.projectId)
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Git context unavailable",
              };
            try {
              const args = params as Record<string, unknown>;
              const action =
                request.name === "git_add"
                  ? { action: "add", paths: args.paths }
                  : request.name === "git_commit"
                    ? { action: "commit", message: args.message }
                    : request.name === "git_create_branch"
                      ? { action: "createBranch", name: args.name }
                      : request.name === "git_switch_branch"
                        ? { action: "switchBranch", name: args.name }
                        : request.name === "git_pull"
                          ? { action: "pull" }
                          : { action: "push" };
              const result = await this.#options.git.runAgentAction(session.projectId, action, {
                turnId: turn.id,
                toolCallId: request.id,
                signal: controller.signal,
                ...(projectLock?.handle === null || projectLock === null
                  ? {}
                  : { inheritedLock: projectLock.handle }),
                assertAuthorized: () => {
                  assertAuthorized();
                  if (checkBudget() !== "ok" || lockLost)
                    throw new GitError("GIT_CONFLICT", "Execution no longer authorized");
                },
              });
              return {
                ok: true,
                summary: `Git ${(params as { action?: string }).action ?? "action"} completed`,
                data: result,
              };
            } catch (error) {
              return gitFailure(error, "Git action failed");
            }
          },
          loadSecrets,
          refreshObservations: async () => {
            if (checkBudget() !== "ok") {
              return {
                ok: false,
                errorCode: "TOOL_ERROR",
                summary: "execution is no longer authorized",
              };
            }

            try {
              const pm2 = await this.#options.pm2Context?.(session.projectId);
              const git =
                project === null
                  ? null
                  : {
                      detected: await detectGit(project.realPath),
                      observedAt: this.#now(),
                    };

              if (git !== null && project !== null && git.detected !== project.gitDetected) {
                immediateTransaction(this.#options.db, (tx) =>
                  updateProjectRow(tx, project.id, {
                    gitDetected: git.detected,
                    updatedAt: project.updatedAt,
                  }),
                );
              }

              const snapshot = buildObservationSnapshot({
                db: this.#options.db,
                session,
                workspaceRoot: projectRoot,
                pm2: pm2 ?? null,
                git,
                now: this.#now(),
              });

              return {
                ok: true,
                summary: `observations refreshed at ${snapshot.observedAt}`,
                data: snapshot,
              };
            } catch {
              return {
                ok: false,
                errorCode: "TOOL_ERROR",
                summary: "observation refresh failed",
              };
            }
          },
        },
      );
    try {
      if (project === null) {
        projectRoot = await realpath(session.workspacePath);
      }

      const resolved = await this.#options.resolveProvider(session, turn);
      immediateTransaction(this.#options.db, (tx) => {
        updateTurnRow(tx, turn.id, {
          provider: resolved.adapter.id,
          model: resolved.model,
        });
      });
      const contextWindow =
        resolved.contextWindow ?? resolved.adapter.capabilities.maxContextTokens;
      const contextOptions = {
        db: this.#options.db,
        registry: this.#options.registry,
        maxContextTokens: contextWindow,
        policy,
        contextRatio: this.#budget.contextRatio,
        workspaceRoot: projectRoot,
        pm2Context: await this.#options.pm2Context?.(session.projectId),
        ...(gitObservation === undefined ? {} : { git: gitObservation }),
      };
      const assembleStarted = this.#now();
      let context = assembleContext(contextOptions, session, turn);
      timing.assembleMs += this.#now() - assembleStarted;
      let messages: ModelMessage[] = context.messages;
      const tools: ToolSchema[] = context.tools;

      this.#transition(turn, session, "PREPARING", startedAt);

      if (checkBudget() === "cancel") {
        return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
      }

      this.#transition(turn, session, "RUNNING");

      if (shouldCompress(context.estimatedTokens, contextWindow)) {
        const summaryStarted = this.#now();

        try {
          const compression = await compressContext({
            db: this.#options.db,
            session,
            turn,
            adapter: resolved.adapter,
            model: resolved.model,
            ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
            ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
            contextWindow,
            tokensBefore: context.estimatedTokens,
            now: () => this.#now(),
            signal: controller.signal,
            timeoutMs: Math.max(1_000, deadline - this.#now()),
          });

          if (compression !== null) {
            this.#emit(turn, session, "context.compressed", {
              turnId: turn.id,
              summaryId: compression.summaryId,
              coveredUpToSeq: compression.coveredUpToSeq,
              tokensBefore: compression.tokensBefore,
              tokensAfter: compression.tokensAfter,
              degraded: compression.degraded,
            });
            context = assembleContext(contextOptions, session, turn);
            messages = context.messages;
          }
        } catch {
          // Compression is best-effort; keep the truncated context on failure.
        } finally {
          timing.summaryMs += this.#now() - summaryStarted;
        }
      }

      while (this.#budget.maxSteps === 0 || steps < this.#budget.maxSteps) {
        const budgetState = checkBudget();

        if (budgetState === "cancel") {
          return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
        }

        if (budgetState === "budget") {
          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            budgetExhausted: true,
            budgetCause: "duration",
          });
        }

        if (!renewProjectLock()) {
          return await finalize("FAILED", {
            eventType: "turn.failed",
            errorCode: "RESOURCE_LOCKED",
            message: "project write lock was lost",
          });
        }

        // Ask the model to land the turn before the budget cuts it mid-sentence.
        const spentTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

        if (!wrapUpRequested && this.#shouldRequestWrapUp(steps, startedAt, spentTokens)) {
          wrapUpRequested = true;
          messages.push({
            role: "user",
            content: `This turn is near its budget (${steps} steps, ${Math.round(spentTokens / 1000)}k tokens). Stop exploring: finish the operation in progress, update the plan to match reality, and reply with a concise summary of what changed, what was verified, and what remains unfinished. Do not start new work.`,
          });
          this.#options.logger?.info(
            { turnId, sessionId: session.id, steps, maxSteps: this.#budget.maxSteps },
            "turn wrap-up requested",
          );
        }

        steps += 1;
        const assistantMessageId = newId("msg");
        let text = "";
        let reasoning = "";
        const toolRequests: ToolCallRequest[] = [];
        let finishReason: ProviderFinishReason = "other";
        let stepUsage: ProviderUsage | undefined;
        let providerError: { code: string; message: string } | null = null;

        const remainingMs = Math.max(1_000, deadline - this.#now());
        const stepStartedAt = this.#now();
        const heuristicTokens = estimateRequestTokens(messages, tools);
        let estimatedInputTokens = calibrateEstimate({
          heuristicTokens,
          anchoredHeuristicTokens,
          anchoredProviderTokens,
        });
        const reservedOutput = reservedOutputTokens({
          maxOutputTokens: this.#budget.maxOutputTokens,
          contextWindow,
        });
        let projectedTokens = estimatedInputTokens + reservedOutput;
        const watermark = contextWatermark(projectedTokens, contextWindow);

        if (steps > 0 && watermark !== "ok") {
          this.#options.logger?.info(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              heuristicTokens,
              estimatedInputTokens,
              projectedTokens,
              watermark,
              factsEmpty: facts.isEmpty(),
              messageCount: messages.length,
            },
            "checkpoint evaluation",
          );
        }

        if (steps > 0 && messages.length > 2 && watermark !== "ok" && !facts.isEmpty()) {
          const checkpointAt = this.#now();
          // Compare on the same basis: both sides are heuristic estimates, so
          // the reported "before/after" volume is like-for-like.
          const tokensBefore = heuristicTokens;
          const snapshot = facts.snapshot();
          const candidate = [
            messages[0] as ModelMessage,
            checkpointMessage(snapshot, checkpointAt),
          ];
          const after = estimateRequestTokens(candidate, tools);

          // Only replace history when it actually buys room for later steps.
          if (tokensBefore - after >= CHECKPOINT_MIN_GAIN) {
            const coveredUpToSeq = latestEventSeq(this.#options.db, session.id);
            const saved = saveTurnCheckpoint(this.#options.db, {
              sessionId: session.id,
              turnId: turn.id,
              coveredUpToSeq,
              summary: JSON.stringify(snapshot),
              tokensBefore,
              tokensAfter: after,
              degraded: false,
              reason: watermark === "hard" ? "hard_watermark" : "soft_watermark",
              now: checkpointAt,
            });

            messages = candidate;
            estimatedInputTokens = after;
            projectedTokens = after + reservedOutput;
            anchoredHeuristicTokens = undefined;
            anchoredProviderTokens = undefined;

            this.#emit(turn, session, "context.checkpoint", {
              turnId: turn.id,
              summaryId: saved.id,
              scope: "turn",
              reason: watermark === "hard" ? "hard_watermark" : "soft_watermark",
              coveredUpToSeq: saved.coveredUpToSeq,
              tokensBefore,
              tokensAfter: after,
              files: snapshot.files.length,
              failures: snapshot.failures.length,
              openSteps: snapshot.openSteps.length,
            });
          }
        }

        if (projectedTokens > contextWindow) {
          // Stop honestly instead of letting the provider reject the request.
          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            budgetExhausted: true,
            budgetCause: "context",
          });
        }

        if (this.#budget.maxTotalTokens > 0) {
          const spentTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);

          if (spentTokens >= this.#budget.maxTotalTokens) {
            return await finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
              budgetCause: "tokens",
            });
          }
        }

        if (contextWatermark(projectedTokens, contextWindow) === "soft") {
          this.#options.logger?.info(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              estimatedInputTokens,
              projectedTokens,
              contextWindow,
            },
            "context soft watermark",
          );
        }

        for await (const chunk of resolved.adapter.streamStep({
          model: resolved.model,
          messages,
          tools,
          signal: controller.signal,
          timeoutMs: remainingMs,
          ...(this.#budget.maxOutputTokens > 0
            ? { maxOutputTokens: this.#budget.maxOutputTokens }
            : {}),
          maxRetries: 1,
          ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
          ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
          ...(resolved.thinking === undefined ? {} : { thinking: resolved.thinking }),
        })) {
          if (chunk.type === "text-delta") {
            if (steps === 1 && timing.firstTokenMs === undefined) {
              timing.firstTokenMs = this.#now() - stepStartedAt;
            }

            text += chunk.text;
            this.#publishDelta(turn, session, {
              kind: "assistant.delta",
              protocolVersion: 1,
              topic: "agent",
              streamId: turn.sessionId,
              sessionId: turn.sessionId,
              turnId: turn.id,
              messageId: assistantMessageId,
              text: chunk.text,
              timestamp: this.#now(),
            });
            continue;
          }

          if (chunk.type === "reasoning-delta") {
            reasoning += chunk.text;
            this.#publishDelta(turn, session, {
              kind: "assistant.reasoning.delta",
              protocolVersion: 1,
              topic: "agent",
              streamId: turn.sessionId,
              sessionId: turn.sessionId,
              turnId: turn.id,
              messageId: assistantMessageId,
              text: chunk.text,
              timestamp: this.#now(),
            });
            continue;
          }

          if (chunk.type === "tool-call") {
            toolRequests.push(chunk.toolCall);
            continue;
          }

          if (chunk.type === "finish") {
            finishReason = chunk.finishReason;
            stepUsage = chunk.usage;
            continue;
          }

          providerError = {
            code: chunk.error.code,
            message: chunk.error.message,
          };
          break;
        }

        usage = addUsage(usage, stepUsage);

        if (stepUsage?.inputTokens !== undefined) {
          anchoredHeuristicTokens = heuristicTokens;
          anchoredProviderTokens = stepUsage.inputTokens;
        }

        if (stepUsage !== undefined) {
          this.#emit(turn, session, "model.usage", {
            turnId: turn.id,
            model: resolved.model,
            ...(stepUsage.inputTokens === undefined ? {} : { inputTokens: stepUsage.inputTokens }),
            ...(stepUsage.outputTokens === undefined
              ? {}
              : { outputTokens: stepUsage.outputTokens }),
            ...(stepUsage.totalTokens === undefined ? {} : { totalTokens: stepUsage.totalTokens }),
            ...(stepUsage.cacheReadTokens === undefined
              ? {}
              : { cacheReadTokens: stepUsage.cacheReadTokens }),
            ...(stepUsage.noCacheTokens === undefined
              ? {}
              : { noCacheTokens: stepUsage.noCacheTokens }),
            usageSource: stepUsage.cacheReadTokens === undefined ? "unknown" : "provider",
            contextWindow: resolved.contextWindow ?? resolved.adapter.capabilities.maxContextTokens,
          });
        }

        const afterStep = checkBudget();

        if (afterStep === "cancel") {
          return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
        }

        if (providerError !== null) {
          if (providerError.code === "PROVIDER_ABORTED") {
            if (deadlineReached) {
              return await finalize("COMPLETED", {
                eventType: "turn.completed",
                budgetExhausted: true,
                budgetCause: "duration",
              });
            }

            const current = getTurnById(this.#options.db, turn.id);

            if (current?.status === "CANCELLING") {
              return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
            }

            return await finalize("FAILED", {
              eventType: "turn.failed",
              errorCode: "PROVIDER_UNAVAILABLE",
              message: "执行超时或连接中断，请重试",
            });
          }

          return await finalize("FAILED", {
            eventType: "turn.failed",
            errorCode: providerError.code,
            message: providerError.message,
          });
        }

        if (text.length > 0) {
          this.#emit(turn, session, "assistant.message", {
            turnId: turn.id,
            messageId: assistantMessageId,
            text,
          });
        }

        if (toolRequests.length === 0) {
          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            finishReason,
          });
        }

        messages.push({
          role: "assistant",
          content: text,
          toolCalls: toolRequests,
          ...(reasoning.length === 0 ? {} : { reasoning }),
        });

        for (const request of toolRequests) {
          const cancelState = checkBudget();

          if (cancelState === "budget")
            return await finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
              budgetCause: "duration",
            });
          if (cancelState === "cancel") {
            return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
          }

          toolCalls += 1;

          if (this.#budget.maxToolCalls > 0 && toolCalls > this.#budget.maxToolCalls) {
            return await finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
              budgetCause: "tool_calls",
            });
          }

          const definition = this.#options.registry.get(request.name);
          const argsSummary = definition?.summarize?.(request.args) ?? request.name;

          this.#emit(turn, session, "tool.requested", {
            turnId: turn.id,
            toolCallId: request.id,
            name: request.name,
            argsSummary,
          });

          let approvalId: string | undefined;
          const risk = definition?.classifyRisk?.(request.args) ?? definition?.riskLevel ?? "L2";
          const access = definition === undefined ? "allow" : decideToolAccess(policy, risk);
          const needsProjectLock =
            definition !== undefined &&
            definition.requiresProjectLock !== false &&
            risk !== "L0" &&
            session.projectId !== null;

          if (needsProjectLock && access === "allow") {
            if (!acquireProjectLock() || !renewProjectLock()) {
              const result = {
                ok: false,
                errorCode: "RESOURCE_LOCKED",
                summary: "project is locked by another writer",
              };
              facts.recordToolFailure(result.errorCode, result.summary);
              const lockedKey = stableArgsKey(request.name, request.args);
              failedCalls.set(lockedKey, [...(failedCalls.get(lockedKey) ?? []), request.id]);
              this.#emit(turn, session, "tool.failed", {
                turnId: turn.id,
                toolCallId: request.id,
                errorCode: result.errorCode,
                message: result.summary,
              });
              messages.push({
                role: "tool",
                toolCallId: request.id,
                toolName: request.name,
                content: toolMessageContent(result),
                isError: true,
              });
              continue;
            }
          }

          this.#emit(turn, session, "tool.started", {
            turnId: turn.id,
            toolCallId: request.id,
            name: request.name,
          });

          const toolStartedAt = this.#now();
          const outcome: ToolExecutionOutcome = await execute(request);
          timing.toolMs += this.#now() - toolStartedAt;

          if (outcome.status === "approval_required") {
            this.#transition(turn, session, "WAITING_APPROVAL");
            this.#emit(turn, session, "tool.approval.required", {
              turnId: turn.id,
              toolCallId: request.id,
              approvalId: outcome.approval.id,
              toolName: request.name,
              risk,
              summary:
                typeof (outcome.approval.scope as { summary?: unknown }).summary === "string"
                  ? (outcome.approval.scope as { summary: string }).summary
                  : request.name,
              scope: outcome.approval.scope,
              expiresAt: outcome.approval.expiresAt,
            });

            const decision = await this.#waitForApproval(
              outcome.approval,
              controller.signal,
              startedAt + this.#budget.maxDurationMs,
            );

            if (decision === "cancelled") {
              if (deadlineReached) {
                return await finalize("COMPLETED", {
                  eventType: "turn.completed",
                  budgetExhausted: true,
                  budgetCause: "duration",
                });
              }

              return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
            }

            this.#emit(turn, session, "tool.approval.resolved", {
              turnId: turn.id,
              approvalId: outcome.approval.id,
              decision,
            });

            if (decision === "approved") {
              approvalId = outcome.approval.id;
            } else {
              this.#transition(turn, session, "RUNNING");
            }
          }

          let result: ToolExecutionOutcome = outcome;

          if (outcome.status === "approval_required") {
            if (approvalId !== undefined) {
              if (needsProjectLock && (!acquireProjectLock() || !renewProjectLock())) {
                result = {
                  status: "completed",
                  result: {
                    ok: false,
                    errorCode: "RESOURCE_LOCKED",
                    summary: "project is locked by another writer",
                  },
                };
              } else {
                this.#transition(turn, session, "RUNNING");
                result = await execute(request, approvalId);
              }
            } else {
              result = {
                status: "completed",
                result: {
                  ok: false,
                  errorCode: "APPROVAL_DENIED",
                  summary: "tool was not approved",
                },
              };
            }

            this.#transition(turn, session, "RUNNING");
          }

          if (result.status === "approval_required") {
            return await finalize("FAILED", {
              eventType: "turn.failed",
              errorCode: "APPROVAL_INVALID",
              message: "approval was requested twice for one tool call",
            });
          }

          if (result.result.ok) {
            const fileResult =
              request.name === "apply_patch" || request.name === "write_file"
                ? (result.result.data as { path?: unknown; version?: unknown } | undefined)
                : undefined;
            const fileTarget = FileResultTargetSchema.safeParse({
              kind: "file",
              scope: session.projectId
                ? { projectId: session.projectId }
                : this.#options.dataDir &&
                    isDefaultWorkspace(this.#options.dataDir, session.workspacePath)
                  ? { workspace: "default" }
                  : { sessionId: session.id },
              path: fileResult?.path,
              version: fileResult?.version,
            });
            const terminalResult =
              request.name === "start_project_terminal"
                ? (result.result.data as { terminalId?: unknown; role?: unknown } | undefined)
                : undefined;
            const previewResult =
              request.name === "resolve_service_preview"
                ? (result.result.data as
                    | { serviceId?: unknown; path?: unknown; projectId?: unknown }
                    | undefined)
                : undefined;
            const registeredTarget = registeredServiceTarget(
              request.name,
              result.result.data,
              session.projectId,
            );
            const previewTarget =
              session.projectId === null
                ? undefined
                : PreviewResultTargetSchema.safeParse({
                    kind: "preview",
                    projectId: session.projectId,
                    serviceId: registeredTarget?.serviceId ?? previewResult?.serviceId,
                    path: registeredTarget?.path ?? previewResult?.path,
                  });
            const terminalTarget =
              session.projectId === null
                ? undefined
                : TerminalResultTargetSchema.safeParse({
                    kind: "terminal",
                    projectId: session.projectId,
                    terminalId: terminalResult?.terminalId,
                    role: terminalResult?.role ?? null,
                  });
            const target =
              fileTarget.success && fileResult
                ? fileTarget.data
                : previewTarget?.success
                  ? previewTarget.data
                  : terminalTarget?.success
                    ? terminalTarget.data
                    : undefined;
            const stoppedTerminal =
              request.name === "stop_project_terminal"
                ? z
                    .object({
                      terminalId: z.string(),
                      role: z.string().nullable(),
                      status: z.enum(["EXITED", "TERMINATED"]),
                    })
                    .safeParse(result.result.data)
                : undefined;
            const closedTarget =
              stoppedTerminal?.success && session.projectId !== null
                ? TerminalResultTargetSchema.safeParse({
                    kind: "terminal",
                    projectId: session.projectId,
                    terminalId: stoppedTerminal.data.terminalId,
                    role: stoppedTerminal.data.role,
                  })
                : undefined;
            const successKey = stableArgsKey(request.name, request.args);
            repeatFailures.delete(successKey);
            const supersededCalls = failedCalls.get(successKey);

            if (supersededCalls !== undefined) failedCalls.delete(successKey);

            if (request.name === "run_command") {
              facts.recordCommand(result.result.summary);
            }

            facts.recordResource(target);

            this.#emit(turn, session, "tool.completed", {
              turnId: turn.id,
              toolCallId: request.id,
              resultSummary: result.result.summary,
              ...(target === undefined ? {} : { resourceTarget: target }),
              ...(closedTarget?.success ? { closedTerminalTarget: closedTarget.data } : {}),
              ...((terminalTarget?.success || closedTarget?.success) && snapshot
                ? { originClientSessionId: snapshot.clientSessionId }
                : {}),
              ...(result.result.truncated === undefined
                ? {}
                : { truncated: result.result.truncated }),
              ...(supersededCalls === undefined ? {} : { supersedes: supersededCalls }),
            });

            if (request.name === "apply_patch" || request.name === "write_file") {
              const changed = result.result.data as
                | { path?: unknown; version?: unknown }
                | undefined;

              if (typeof changed?.path === "string" && typeof changed.version === "string") {
                facts.recordFile(changed.path, changed.version);
                fileChanges.set(changed.path, {
                  path: changed.path,
                  changeType: request.name === "write_file" ? "created" : "modified",
                  version: changed.version,
                });
                this.#emit(turn, session, "file.changed", {
                  turnId: turn.id,
                  path: changed.path,
                  changeType: request.name === "write_file" ? "created" : "modified",
                  version: changed.version,
                });
              }
            }
          } else {
            const repeatKey = stableArgsKey(request.name, request.args);
            const repeatCount = (repeatFailures.get(repeatKey) ?? 0) + 1;
            repeatFailures.set(repeatKey, repeatCount);
            failedCalls.set(repeatKey, [...(failedCalls.get(repeatKey) ?? []), request.id]);
            facts.recordToolFailure(result.result.errorCode ?? "TOOL_ERROR", result.result.summary);
            const issues = toolFailureIssues(result.result.data);
            this.#emit(turn, session, "tool.failed", {
              turnId: turn.id,
              toolCallId: request.id,
              errorCode: result.result.errorCode ?? "TOOL_ERROR",
              message: result.result.summary,
              ...(issues === undefined ? {} : { issues }),
              ...(repeatCount > 1 ? { repeatCount } : {}),
            });
          }

          messages.push({
            role: "tool",
            toolCallId: request.id,
            toolName: request.name,
            content: toolMessageContent(result.result),
            isError: !result.result.ok,
          });

          const repeatCount = repeatFailures.get(stableArgsKey(request.name, request.args));

          if (
            !result.result.ok &&
            repeatCount !== undefined &&
            repeatCount === this.#budget.repeatFailureThreshold
          ) {
            messages.push({
              role: "user",
              content: `The exact same ${request.name} call with identical arguments has failed ${repeatCount} times in a row and returned the same error. Repeating it will not change the result: change the approach or state what blocks progress.`,
            });
            this.#options.logger?.info(
              { turnId, toolName: request.name, repeatCount },
              "identical tool call keeps failing",
            );
          }
        }
      }

      return await finalize("COMPLETED", {
        eventType: "turn.completed",
        budgetExhausted: true,
        budgetCause: "steps",
      });
    } catch (error) {
      if (finalized) {
        throw error;
      }

      if (deadlineReached) {
        return await finalize("COMPLETED", {
          eventType: "turn.completed",
          budgetExhausted: true,
          budgetCause: "duration",
        });
      }

      if (
        controller.signal.aborted ||
        getTurnById(this.#options.db, turnId)?.status === "CANCELLING"
      ) {
        return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
      }

      if (error instanceof ProviderError) {
        return await finalize("FAILED", {
          eventType: "turn.failed",
          errorCode: error.code,
          message: error.message,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      return await finalize("FAILED", {
        eventType: "turn.failed",
        errorCode: "INTERNAL",
        message: message.slice(0, 500),
      });
    } finally {
      clearTimeout(deadlineTimer);
      clearInterval(heartbeat);
      this.#options.logger?.info(
        {
          turnId,
          sessionId: turn.sessionId,
          steps,
          toolCalls,
          durationMs: this.#now() - startedAt,
          deadlineReached,
          ...timing,
        },
        "turn timing",
      );
      try {
        this.#options.terminals?.releaseAgentLeases(turn.id);
      } catch {
        // A failed release is cleared by the manager timer when the Turn is no longer active.
      }
      if (controller.signal.aborted)
        invalidateTurnApprovals({ db: this.#options.db, now: this.#options.now }, turn.id);
      (projectLock as ProjectWriteLock | null)?.release();
      this.#controllers.delete(turnId);
    }
  }

  async #waitForApproval(
    approval: ApprovalDto,
    signal: AbortSignal,
    deadline: number,
  ): Promise<"approved" | "denied" | "expired" | "cancelled"> {
    const pollMs = this.#options.approvalPollMs ?? APPROVAL_POLL_MS;

    while (!signal.aborted) {
      if (this.#now() >= deadline) {
        invalidateTurnApprovals({ db: this.#options.db, now: this.#options.now }, approval.turnId);
        return "expired";
      }
      const current = getApproval({ db: this.#options.db, now: this.#options.now }, approval.id);

      if (
        current.status === "approved" ||
        current.status === "denied" ||
        current.status === "expired"
      ) {
        return current.status;
      }

      const now = this.#now();

      if (current.expiresAt <= now) {
        return "expired";
      }

      await delay(Math.min(pollMs, current.expiresAt - now, deadline - now), signal);
    }

    return "cancelled";
  }

  #transition(turn: TurnRow, session: SessionRow, status: TurnStatus, startedAt?: number): void {
    const now = this.#now();
    let eventRow: ReturnType<typeof appendAgentEvent> | null = null;

    immediateTransaction(this.#options.db, (tx) => {
      updateTurnRow(tx, turn.id, {
        status,
        ...(status === "PREPARING" ? { startedAt: startedAt ?? now } : {}),
      });
      eventRow = appendAgentEvent(tx, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        type: "turn.status",
        payload: { turnId: turn.id, status },
        now,
      });
    });

    this.#publish(eventRow, session);
  }

  #emit(turn: TurnRow, session: SessionRow, type: string, payload: Record<string, unknown>): void {
    const eventRow = immediateTransaction(this.#options.db, (tx) =>
      appendAgentEvent(tx, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        type,
        payload,
        now: this.#now(),
      }),
    );

    this.#publish(eventRow, session);
  }

  async #collectFileResults(
    root: string,
    projectIgnore: string[] | undefined,
    changes: Map<string, TurnFileChange>,
  ): Promise<TurnFileResult[]> {
    if (changes.size === 0) {
      return [];
    }

    try {
      return await collectTurnFileResults({
        root,
        projectIgnore: projectIgnore ?? [],
        changes: changes.values(),
        onError: (filePath, error) =>
          this.#options.logger?.info(
            {
              path: filePath,
              code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN",
            },
            "turn file result check failed",
          ),
      });
    } catch (error) {
      this.#options.logger?.info(
        { code: (error as NodeJS.ErrnoException).code ?? "UNKNOWN" },
        "turn file result collection failed",
      );
      return [];
    }
  }

  #finalize(
    turn: TurnRow,
    session: SessionRow,
    status: TurnStatus,
    options: {
      eventType: string;
      errorCode?: string;
      message?: string;
      reason?: string;
      budgetExhausted?: boolean;
      budgetCause?: TurnBudgetCause;
      finishReason?: ProviderFinishReason;
      usage?: ProviderUsage;
      durationMs?: number;
      terminalReason?: TurnTerminalReason;
      fileResults?: TurnFileResult[];
      fileResultsOmitted?: number;
    },
  ): TurnRunResult {
    const now = this.#now();
    const terminalReason = options.terminalReason ?? deriveTerminalReason(status, options);
    const errorJson =
      options.errorCode === undefined
        ? null
        : JSON.stringify({ code: options.errorCode, message: options.message ?? "" });
    let eventRow: ReturnType<typeof appendAgentEvent> | null = null;

    immediateTransaction(this.#options.db, (tx) => {
      updateTurnRow(tx, turn.id, {
        status,
        endedAt: now,
        terminalReason,
        ...(errorJson === null ? {} : { errorJson }),
        ...(options.usage === undefined ? {} : { usageJson: JSON.stringify(options.usage) }),
      });
      eventRow = appendAgentEvent(tx, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        type: options.eventType,
        payload: {
          turnId: turn.id,
          status,
          ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
          ...(options.message === undefined ? {} : { message: options.message }),
          ...(options.reason === undefined ? {} : { reason: options.reason }),
          ...(options.usage === undefined ? {} : { usage: options.usage }),
          ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
          ...(options.budgetExhausted === undefined
            ? {}
            : { budgetExhausted: options.budgetExhausted }),
          ...(options.budgetCause === undefined ? {} : { budgetCause: options.budgetCause }),
          ...(options.finishReason === undefined ? {} : { finishReason: options.finishReason }),
          ...(options.fileResults === undefined ? {} : { fileResults: options.fileResults }),
          ...(options.fileResultsOmitted === undefined
            ? {}
            : { fileResultsOmitted: options.fileResultsOmitted }),
          terminalReason,
        },
        now,
      });
      appendAudit(tx, {
        action: status === "COMPLETED" ? "turn.completed" : `turn.${status.toLowerCase()}`,
        decision: status === "COMPLETED" ? "allow" : "deny",
        sessionId: turn.sessionId,
        resourceType: "turn",
        resourceId: turn.id,
        details: {
          status,
          terminalReason,
          ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
          ...(options.budgetExhausted === undefined
            ? {}
            : { budgetExhausted: options.budgetExhausted }),
          ...(options.budgetCause === undefined ? {} : { budgetCause: options.budgetCause }),
        },
        now,
      });
    });

    this.#publish(eventRow, session);

    return {
      status,
      ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
      terminalReason,
      ...(options.budgetCause === undefined ? {} : { budgetCause: options.budgetCause }),
    };
  }

  #publishDelta(
    turn: TurnRow,
    session: SessionRow,
    event: AssistantDeltaEvent | AssistantReasoningDeltaEvent,
  ): void {
    if (session.id !== turn.sessionId) {
      return;
    }

    try {
      (this.#options.publish ?? publishAgentEvent)(event);
    } catch {
      // Streaming deltas are best effort; the final message is persisted.
    }
  }

  #publish(eventRow: ReturnType<typeof appendAgentEvent> | null, session: SessionRow): void {
    if (eventRow === null) {
      return;
    }

    try {
      (this.#options.publish ?? publishAgentEvent)(toServerEvent(eventRow, session));
    } catch {
      // Broadcasting is best effort; the event is already durable.
    }
  }

  /** True when the remaining step or time budget is about to end the turn. */
  #shouldRequestWrapUp(steps: number, startedAt: number, spentTokens: number): boolean {
    const nearSteps = this.#budget.maxSteps >= 8 && steps >= this.#budget.maxSteps - 4;
    const nearTime = this.#now() - startedAt >= this.#budget.maxDurationMs * 0.8;
    const nearTokens =
      this.#budget.maxTotalTokens > 0 && spentTokens >= this.#budget.maxTotalTokens * 0.8;

    return nearSteps || nearTime || nearTokens;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
