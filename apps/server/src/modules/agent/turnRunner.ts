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
import { FileManagerError, OutputRedactor, selectShell } from "@larness/resources";
import {
  type AssistantDeltaEvent,
  type AssistantReasoningDeltaEvent,
  CommandRequestSchema,
  FileResultTargetSchema,
  normalizeCommandRequest,
  PlanParamsSchema,
  ProcessIdSchema,
  type ServerEvent,
  type TurnBudgetCause,
  type TurnFileResult,
} from "@larness/shared";
import { z } from "zod";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { SessionRow, TurnRow, TurnStatus, TurnTerminalReason } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { publishAgentEvent } from "../../ws/publisher.js";
import { createAttachmentToolBridge } from "../attachments/tools.js";
import type { CommandManager } from "../commands/manager.js";
import type { GitManager } from "../git/manager.js";
import { MemoryError, type MemoryService } from "../memory/service.js";
import { resolveCatalogSelection } from "../models/catalog.js";
import { listEncryptedSecrets } from "../models/repository.js";
import type { ProcessManager } from "../processes/manager.js";
import { getProjectById, updateProjectRow } from "../projects/repository.js";
import { detectGit, parseProjectSettings } from "../projects/service.js";
import { DeploymentError } from "../service-ops/errors.js";
import type { ServiceOpsRuntime } from "../service-ops/serviceOps.js";
import { getSessionById, getTurnById, updateTurnRow } from "../sessions/repository.js";
import type { WebSearchRuntime } from "../web-search/runtime.js";
import { DEFAULT_WEB_SEARCH_SETTINGS } from "../web-search/settings.js";
import { isDefaultWorkspace } from "../workspaces/default.js";
import { type ApprovalDto, getApproval, invalidateTurnApprovals } from "./approvalService.js";
import { assembleContext, PROMPT_VERSION } from "./contextAssembler.js";
import { compressContext, shouldCompress } from "./contextCompressor.js";
import { appendAgentEvent, toServerEvent } from "./events.js";
import { buildObservationSnapshot } from "./observationSnapshot.js";
import { disabledToolsForProfile } from "./profiles.js";
import { ProjectWriteLock } from "./projectWriteLock.js";
import { secretVerdict } from "./secretGuard.js";
import {
  calibrateEstimate,
  contextRolloverThreshold,
  contextWatermark,
  estimateRequestTokens,
  reservedOutputTokens,
  shouldFoldToolResults,
} from "./tokenEstimator.js";
import { executeTool, type ToolExecutionOutcome } from "./toolExecutor.js";
import { safeToolSummary } from "./toolSummary.js";
import {
  addUsage,
  DEFAULT_BUDGET,
  deriveTerminalReason,
  preserveCancellation,
  resolveSpendCap,
  type TurnBudget,
} from "./turn/budget.js";
import { carriedSpendTokens } from "./turn/chain.js";
import { foldOldToolResults, lastCompleteToolBatch } from "./turn/compaction.js";
import {
  buildToolOperation,
  MAX_COMMAND_TAIL_CHARS,
  redactOperationText,
} from "./turn/operationLog.js";
import { openPlanSteps } from "./turn/planState.js";
import {
  classifyPrefixBreak,
  type PrefixBreak,
  type PrefixSnapshot,
  prefixSnapshot,
  readPreviousPrefix,
} from "./turn/prefixCache.js";
import {
  type ProviderStepFailure,
  providerRetryDelayMs,
  shouldRetryProviderStep,
} from "./turn/providerRetry.js";
import { createSecretLoader } from "./turn/secrets.js";
import { isStalled } from "./turn/stall.js";
import { stableArgsKey, turnInputText } from "./turn/text.js";
import { buildToolReplay } from "./turn/toolReplay.js";
import {
  boundedCommandOutput,
  commandModelText,
  foldBatchToolResults,
  MAX_BATCH_TOOL_RESULT_TOKENS,
  toolFailureIssues,
  toolMessageContent,
} from "./turn/toolResults.js";
import {
  checkpointMessage,
  latestEventSeq,
  pinnedRequestMessage,
  saveTurnCheckpoint,
  TurnFactsBuilder,
} from "./turnCheckpoint.js";
import { collectTurnFileResults, type TurnFileChange } from "./turnResults.js";
import { FetchUrlToolSchema, WEB_TOOL_NAMES, WebSearchToolSchema } from "./webTool.js";

function commandDisplay(params: unknown) {
  const request = CommandRequestSchema.parse(normalizeCommandRequest(params));
  const redact = (value: string) => new OutputRedactor([]).push(value, true);

  if (request.mode === "shell") {
    return {
      command: redact(request.command),
      cwd: redact(request.cwd),
    };
  }

  let hideNext = false;
  return {
    executable: redact(request.executable),
    cwd: redact(request.cwd),
    args: request.args.map((value) => {
      const hide = hideNext;
      hideNext = /^--?(authorization|api[_-]?key|token|password|cookie|secret)$/i.test(value);
      return hide ? "[Redacted]" : redact(value);
    }),
  };
}

const APPROVAL_POLL_MS = 100;
const CHECKPOINT_MIN_GAIN = 200;
const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 250;
/** Per-request cap; the Turn wall clock is only an emergency guard. */
const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;
/** Pause/ask when nothing has moved for this long; never a total task budget. */
const DEFAULT_STALL_TIMEOUT_MS = 10 * 60_000;
/**
 * Upper bound on a batch that may be executed concurrently. Only a batch made
 * entirely of pure reads qualifies, so the ordering the serial loop guarantees
 * for events, budget checks and messages is unaffected.
 */
const READ_PREFETCH_LIMIT = 8;

function acceptsImagesForTurn(db: Database, turn: TurnRow): boolean {
  if (turn.model === null) return false;
  try {
    return (
      resolveCatalogSelection(db, {
        model: turn.model,
        thinking: turn.thinking,
        credentialProfileId: turn.credentialProfileId,
      }).acceptsImages === true
    );
  } catch {
    return false;
  }
}

export interface ResolvedProvider {
  adapter: ProviderAdapter;
  model: string;
  apiKey?: string;
  endpoint?: string;
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
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
  /** How long a write tool waits for a busy project lock before failing. */
  lockWaitMs?: number;
  lockPollMs?: number;
  /** Per-model-request timeout; defaults to 10 minutes. */
  requestTimeoutMs?: number;
  /** Base backoff between provider step retries; defaults to 1s (tests use 0). */
  providerRetryDelayMs?: number;
  /** No-progress pause threshold; 0 disables the check. Defaults to 10 minutes. */
  stallTimeoutMs?: number;
  commands?: CommandManager;
  git?: GitManager;
  processes?: ProcessManager;
  serviceOps?: ServiceOpsRuntime;
  memory?: MemoryService;
  attachments?: import("../attachments/service.js").AttachmentService;
  attachmentInlineTokens?: number;
  attachmentContextRatio?: number;
  secretStore?: import("../../security/secretStore.js").SecretStore;
  webSearch?: WebSearchRuntime;
  pm2Context?: (projectId: string | null) => Promise<import("@larness/shared").Pm2CommandContext>;
  logger?: TurnTimingLogger;
  /**
   * Best-effort session title summary when the session's first turn starts.
   * Opt-in: the wiring decides whether a process spends a model call on titles.
   */
  titleSummarizer?: (context: {
    session: SessionRow;
    turn: TurnRow;
    resolved: ResolvedProvider;
  }) => Promise<void>;
}

export interface TurnTimingLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

// The cause union lives in @larness/shared so the timeline can label a stop
// without the server and the web app drifting apart.
export type { TurnBudgetCause };

export type TurnRunResult = {
  status: TurnStatus;
  errorCode?: string;
  terminalReason?: TurnTerminalReason;
  /** Which budget stopped the turn; only spend/context stops are continuable. */
  budgetCause?: TurnBudgetCause;
};

type BudgetState = "ok" | "cancel" | "budget" | "shutdown";

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

export class TurnRunner {
  readonly #options: TurnRunnerOptions;
  readonly #budget: TurnBudget;
  readonly #controllers = new Map<string, AbortController>();
  readonly #titleWork = new Set<Promise<unknown>>();
  #stopReason: "user" | "shutdown" | null = null;

  #trackTitleWork(task: Promise<void>): void {
    const guarded = task.catch(() => {}) as Promise<unknown>;
    this.#titleWork.add(guarded);
    void guarded.finally(() => this.#titleWork.delete(guarded));
  }

  /** Background title summaries never block a turn; tests and shutdown await this. */
  async pendingTitleWork(): Promise<void> {
    await Promise.all([...this.#titleWork]);
  }

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

  stop(reason: "user" | "shutdown" = "user"): void {
    this.#stopReason = reason;
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
    const requestTimeoutMs = Math.max(
      1_000,
      this.#options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    const stallTimeoutMs = Math.max(0, this.#options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS);
    let lastProgressAt = this.#now();
    const markProgress = (): void => {
      lastProgressAt = this.#now();
    };
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
    // One probe per Turn keeps the project metadata fresh; Git is a human UI
    // concern now, so it is not injected into the model context.
    if (project !== null) {
      const detected = await detectGit(project.realPath);

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
    let missingUsageSteps = 0;
    let steps = 0;
    let toolCalls = 0;
    let planNudged = false;
    const approvedApprovalKeys = new Set<string>();
    let finalized = false;
    const timing = {
      assembleMs: 0,
      summaryMs: 0,
      toolMs: 0,
      firstTokenMs: undefined as number | undefined,
    };
    let anchoredHeuristicTokens: number | undefined;
    let anchoredProviderTokens: number | undefined;
    const facts = new TurnFactsBuilder(turnInputText(turn.inputJson));
    // Profile membership is enforced at execution, not only in the advertised
    // schema: a model that hallucinates a hidden built-in tool must not reach
    // its handler. Extension/test tools outside the catalog stay available.
    const webRuntime = this.#options.webSearch;
    const webSettings = webRuntime?.settings() ?? DEFAULT_WEB_SEARCH_SETTINGS;
    const webToolsEnabled = turn.webSearchEnabled;
    const webSearchAvailable = webToolsEnabled && (webRuntime?.available() ?? false);
    const disabledTools = new Set(disabledToolsForProfile(session.agentProfile));
    // Only the explicit switch removes the tools. When it is on but the
    // connection is down, the handler fails with a stable code instead of the
    // tool array changing under the cached prefix.
    if (!webToolsEnabled) {
      for (const name of WEB_TOOL_NAMES) disabledTools.add(name);
    }
    let webSearchCalls = 0;
    let webFetchCalls = 0;
    const webSearchCache = new Map<string, ToolResult>();
    const webFetchCache = new Map<string, ToolResult>();
    // First-touch order survives; later writes only refresh the version.
    const fileChanges = new Map<string, TurnFileChange>();
    const repeatFailures = new Map<string, number>();
    // Failed callIds per (tool, canonical args), so a later identical success can
    // tell the UI which earlier attempts it superseded.
    const failedCalls = new Map<string, string[]>();
    // One secret table read per Turn (D8); plaintext is still decrypted per call.
    const loadSecrets = createSecretLoader(() => listEncryptedSecrets(this.#options.db));
    let projectMemoryWrites = 0;
    let globalMemoryWrites = 0;

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
        terminalReason?: TurnTerminalReason;
      },
    ): Promise<TurnRunResult> => {
      const fileResults = await this.#collectFileResults(projectRoot, projectIgnore, fileChanges);
      const omitted = fileChanges.size - fileResults.length;
      const persistedUsage: ProviderUsage & { missingSteps?: number } =
        missingUsageSteps === 0 ? usage : { ...usage, missingSteps: missingUsageSteps };
      // `cancelTurn` can commit CANCELLING while file results are being
      // collected. The late terminal write must not overwrite that intent, or
      // a user-visible Stop would be replaced by COMPLETED and could even
      // trigger an automatic continuation.
      const cancelled =
        status !== "CANCELLED" &&
        preserveCancellation(status, getTurnById(this.#options.db, turn.id)?.status ?? null) ===
          "CANCELLED";
      const result = this.#finalize(turn, session, cancelled ? "CANCELLED" : status, {
        ...(cancelled
          ? {
              eventType: "turn.cancelled",
              reason: "user",
              terminalReason: "cancelled" as const,
            }
          : options),
        usage: persistedUsage,
        durationMs: this.#now() - startedAt,
        ...(fileResults.length === 0 ? {} : { fileResults }),
        ...(omitted <= 0 ? {} : { fileResultsOmitted: omitted }),
      });
      finalized = true;

      return result;
    };

    const checkBudget = (): BudgetState => {
      if (controller.signal.aborted) {
        return deadlineReached ? "budget" : this.#stopReason === "shutdown" ? "shutdown" : "cancel";
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

    const finalizeStop = (state: "cancel" | "shutdown"): Promise<TurnRunResult> =>
      state === "shutdown"
        ? finalize("INTERRUPTED", {
            eventType: "turn.interrupted",
            reason: "shutdown",
            message: "执行因 Larness 关闭而中断，可在重启后继续",
          })
        : finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });

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
    let lockWasLost = false;
    let lockNoticeSent = false;
    const dropLock = () => {
      try {
        // Best effort: clear our own row so it cannot keep blocking retries.
        // A takeover keeps its higher fencing token and release does nothing.
        projectLock?.release();
      } catch {
        /* The lease still expires; the Turn can continue read-only. */
      }
      lockLost = true;
      lockWasLost = true;
      projectLock = null;
    };
    const heartbeat = setInterval(
      () => {
        try {
          if (!renewProjectLock()) dropLock();
        } catch {
          dropLock();
        }
      },
      Math.max(10, Math.min(1000, (this.#options.lockTtlMs ?? 30_000) / 3)),
    );
    heartbeat.unref();
    const execute = (request: ToolCallRequest, approvalId?: string) =>
      executeTool(
        {
          db: this.#options.db,
          registry: this.#options.registry,
          disabledTools,
          now: this.#options.now,
        },
        {
          sessionId: session.id,
          turnId: turn.id,
          toolCallId: request.id,
          toolName: request.name,
          args: request.args,
          policy,
          projectRoot,
          ...(this.#options.attachments === undefined
            ? {}
            : { attachments: createAttachmentToolBridge(this.#options.attachments, session.id) }),
          ...(projectIgnore === undefined || projectIgnore.length === 0
            ? {}
            : { ignore: projectIgnore }),
          signal: controller.signal,
          approvedParams: approvedApprovalKeys,
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
            markProgress();
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
              const parsedRequest = CommandRequestSchema.safeParse(normalizeCommandRequest(params));
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
              const bounded = boundedCommandOutput(completeText, 32_000);
              const stdout = boundedCommandOutput(
                output.chunks
                  .filter((chunk) => chunk.channel === "stdout")
                  .map((chunk) => chunk.data)
                  .join(""),
                32_000,
              );
              const stderr = boundedCommandOutput(
                output.chunks
                  .filter((chunk) => chunk.channel === "stderr")
                  .map((chunk) => chunk.data)
                  .join(""),
                16_000,
              );
              let shellName: string | undefined;
              if (parsedRequest.success && parsedRequest.data.mode === "shell") {
                try {
                  shellName = selectShell(parsedRequest.data.command).name;
                } catch {
                  /* The manager already failed closed if no shell was available. */
                }
              }
              const truncated =
                row.truncated ||
                output.truncated ||
                output.resyncRequired ||
                bounded.truncated ||
                stdout.truncated ||
                stderr.truncated ||
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
                  output: bounded.text,
                  stdout: stdout.text,
                  stderr: stderr.text,
                  ...(shellName === undefined ? {} : { shell: shellName }),
                  truncated,
                },
                modelText: commandModelText({
                  status: row.status,
                  exitCode: row.exitCode,
                  ...(shellName === undefined ? {} : { shell: shellName }),
                  output: bounded.text,
                  truncated,
                }),
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Command execution failed",
              };
            }
          },
          startProcess: async (params, assertAuthorized) => {
            if (!snapshot || !this.#options.processes || !session.projectId) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Process context unavailable",
              };
            }
            try {
              const dto = await this.#options.processes.start(
                {
                  sessionId: session.id,
                  turnId: turn.id,
                  toolCallId: request.id,
                  clientSessionId: snapshot.clientSessionId,
                  policySnapshotId: snapshot.policySnapshotId,
                  projectId: session.projectId,
                  signal: controller.signal,
                  assertAuthorized: () => {
                    assertAuthorized();
                    if (checkBudget() !== "ok" || lockLost)
                      throw new Error("Execution no longer authorized");
                  },
                },
                params,
              );
              const output = await this.#options.processes.readOutput(
                dto.id,
                {
                  sessionId: session.id,
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                },
                0,
                50,
              );
              const tail = output.chunks
                .map((chunk) => chunk.data)
                .join("")
                .slice(-4_000);
              const running = dto.status === "RUNNING";
              return {
                ok: running,
                summary: `Process ${dto.name ?? dto.id.slice(-6)} ${dto.status}`,
                ...(running ? {} : { errorCode: dto.reasonCode ?? "PROCESS_EXITED" }),
                data: { ...dto, output: tail, outputTruncated: output.truncated },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Process could not be started",
              };
            }
          },
          listProcesses: async (params) => {
            if (!session.projectId || !this.#options.processes) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Process context unavailable",
              };
            }
            const parsed = z
              .object({ limit: z.number().int().min(1).max(200).default(100) })
              .strict()
              .safeParse(params);
            if (!parsed.success) {
              return {
                ok: false,
                errorCode: "VALIDATION_ERROR",
                summary: "Invalid process list request",
              };
            }
            const items = this.#options.processes
              .list({ projectId: session.projectId })
              .slice(0, parsed.data.limit);
            return {
              ok: true,
              summary: `${items.length} 个后台任务`,
              data: { items },
            };
          },
          readProcessOutput: async (params) => {
            const parsed = z
              .object({
                processId: ProcessIdSchema,
                after: z.number().int().min(0).default(0),
                limit: z.number().int().min(1).max(500).default(100),
              })
              .strict()
              .safeParse(params);
            if (!parsed.success || !snapshot || !this.#options.processes || !session.projectId) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Process output context unavailable",
              };
            }
            try {
              const page = await this.#options.processes.readOutput(
                parsed.data.processId,
                {
                  sessionId: session.id,
                  clientSessionId: snapshot.clientSessionId,
                  projectId: session.projectId,
                },
                parsed.data.after,
                parsed.data.limit,
              );
              return {
                ok: true,
                summary: `${page.chunks.length} process output chunks`,
                truncated: page.truncated || page.resyncRequired,
                data: page,
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Process output could not be read",
              };
            }
          },
          stopProcess: async (params, assertAuthorized) => {
            const parsed = z.object({ processId: ProcessIdSchema }).strict().safeParse(params);
            if (!parsed.success || !snapshot || !this.#options.processes || !session.projectId) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Process context unavailable",
              };
            }
            try {
              assertAuthorized();
              const result = await this.#options.processes.stop(parsed.data.processId, {
                sessionId: session.id,
                clientSessionId: snapshot.clientSessionId,
                projectId: session.projectId,
              });
              return {
                ok: result.stopped,
                summary: `Process ${result.process.status}`,
                ...(result.stopped ? {} : { errorCode: "STOP_UNCONFIRMED" }),
                data: { ...result.process, forced: result.forced },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof FileManagerError ? error.code : "TOOL_ERROR",
                summary: "Process could not be stopped",
              };
            }
          },
          listServiceOps: async () => {
            if (!this.#options.serviceOps) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service operations context unavailable",
              };
            }
            try {
              await this.#options.serviceOps.reconcile();
              return {
                ok: true,
                summary: `${this.#options.serviceOps.listServices().length} 个 PM2 服务`,
                data: {
                  items: this.#options.serviceOps.listServices(),
                  unassociated: this.#options.serviceOps.listUnassociatedServices(),
                },
              };
            } catch (error) {
              return {
                ok: false,
                errorCode: error instanceof DeploymentError ? error.code : "TOOL_ERROR",
                summary: "PM2 services could not be listed",
              };
            }
          },
          readServiceOpsLogs: async (params) => {
            const parsed = z
              .object({ targetId: z.string().min(1) })
              .strict()
              .safeParse(params);
            if (!parsed.success || !this.#options.serviceOps) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service operations context unavailable",
              };
            }
            try {
              const logs = await this.#options.serviceOps.logs(parsed.data.targetId);
              return {
                ok: true,
                summary: `PM2 日志 ${logs.text.length} 字符`,
                truncated: logs.truncated,
                data: logs,
              };
            } catch (error) {
              return {
                ok: false,
                errorCode:
                  error instanceof DeploymentError || error instanceof FileManagerError
                    ? error.code
                    : "TOOL_ERROR",
                summary: "PM2 logs could not be read",
              };
            }
          },
          controlServiceOps: async (params) => {
            const parsed = z
              .object({
                targetId: z.string().min(1),
                action: z.enum(["start", "stop", "restart"]),
              })
              .strict()
              .safeParse(params);
            if (!parsed.success || !this.#options.serviceOps || !snapshot) {
              return {
                ok: false,
                errorCode: "FORBIDDEN",
                summary: "Service operations context unavailable",
              };
            }
            try {
              const service = this.#options.serviceOps.getService(parsed.data.targetId);
              const result = await this.#options.serviceOps.controlService(
                service.targetId,
                {
                  action: parsed.data.action,
                  expectedPm2Name: service.pm2Name,
                  requestKey: `tool:${turn.id}:${request.id}`,
                  confirmed: true,
                },
                snapshot.clientSessionId,
                () => {
                  if (checkBudget() !== "ok" || lockLost)
                    throw new FileManagerError("FORBIDDEN", "Execution no longer authorized");
                },
              );
              return {
                ok: result.observedState === "running" || parsed.data.action === "stop",
                summary: `PM2 ${result.name}: ${result.observedState}`,
                data: result,
              };
            } catch (error) {
              return {
                ok: false,
                errorCode:
                  error instanceof DeploymentError || error instanceof FileManagerError
                    ? error.code
                    : "TOOL_ERROR",
                summary: "PM2 control failed",
              };
            }
          },
          ...(webSearchAvailable && webRuntime !== undefined
            ? {
                webSearch: async (raw) => {
                  const parsed = WebSearchToolSchema.safeParse(raw);
                  if (!parsed.success) {
                    return {
                      ok: false,
                      errorCode: "VALIDATION_ERROR",
                      summary: "invalid web_search arguments",
                    };
                  }

                  if (
                    webSettings.maxSearchesPerTurn <= 0 ||
                    webSearchCalls >= webSettings.maxSearchesPerTurn
                  ) {
                    return {
                      ok: false,
                      errorCode: "WEB_SEARCH_LIMIT",
                      summary: `web search limit reached for this Turn (${webSettings.maxSearchesPerTurn}); use the results you already have`,
                    };
                  }

                  const count = Math.min(parsed.data.count, webSettings.maxResults);
                  const cacheKey = `${parsed.data.query}\u0000${count}`;
                  const cached = webSearchCache.get(cacheKey);
                  if (cached !== undefined) return cached;

                  const active = webRuntime.resolveActive();
                  if (active === null) {
                    return {
                      ok: false,
                      errorCode: "WEB_SEARCH_NOT_CONFIGURED",
                      summary: "no active web search connection",
                    };
                  }

                  webSearchCalls += 1;
                  const results = await webRuntime.service.search(
                    active.connection,
                    active.apiKey,
                    { query: parsed.data.query, count, signal: controller.signal },
                  );
                  const result: ToolResult = {
                    ok: true,
                    summary: `${results.length} web results for "${parsed.data.query}"`,
                    data: { query: parsed.data.query, count: results.length, results },
                  };
                  webSearchCache.set(cacheKey, result);
                  return result;
                },
                fetchUrl: async (raw) => {
                  const parsed = FetchUrlToolSchema.safeParse(raw);
                  if (!parsed.success) {
                    return {
                      ok: false,
                      errorCode: "VALIDATION_ERROR",
                      summary: "invalid fetch_url arguments",
                    };
                  }

                  if (
                    webSettings.maxFetchesPerTurn <= 0 ||
                    webFetchCalls >= webSettings.maxFetchesPerTurn
                  ) {
                    return {
                      ok: false,
                      errorCode: "WEB_FETCH_LIMIT",
                      summary: `web fetch limit reached for this Turn (${webSettings.maxFetchesPerTurn}); use the content you already have`,
                    };
                  }

                  const cacheKey = `${parsed.data.url}\u0000${parsed.data.offset}\u0000${parsed.data.maxChars}`;
                  const cached = webFetchCache.get(cacheKey);
                  if (cached !== undefined) return cached;

                  const active = webRuntime.resolveActive();
                  if (active === null) {
                    return {
                      ok: false,
                      errorCode: "WEB_SEARCH_NOT_CONFIGURED",
                      summary: "no active web search connection",
                    };
                  }

                  webFetchCalls += 1;
                  const page = await webRuntime.service.fetchPage(
                    active.connection,
                    active.apiKey,
                    { url: parsed.data.url, signal: controller.signal },
                  );
                  const start = Math.min(parsed.data.offset, page.content.length);
                  const content = page.content.slice(start, start + parsed.data.maxChars);
                  const nextOffset =
                    start + content.length < page.content.length ? start + content.length : null;
                  const result: ToolResult = {
                    ok: true,
                    summary: `fetched ${page.title.length > 0 ? page.title : parsed.data.url}`,
                    data: {
                      url: parsed.data.url,
                      title: page.title,
                      content,
                      offset: start,
                      nextOffset,
                      contentLength: page.content.length,
                      truncated: nextOffset !== null,
                    },
                  };
                  webFetchCache.set(cacheKey, result);
                  return result;
                },
              }
            : {}),
          loadSecrets,
          rememberMemory: async (raw) => {
            if (this.#options.memory === undefined) {
              return { ok: false, errorCode: "FORBIDDEN", summary: "memory is unavailable" };
            }

            const input = raw as import("@larness/shared").RememberToolInput;

            if (input.scope === "project" && projectMemoryWrites >= 3) {
              return {
                ok: false,
                errorCode: "MEMORY_RATE_LIMITED",
                summary: "at most 3 project memories can be written per Turn",
              };
            }

            if (input.scope === "global" && globalMemoryWrites >= 1) {
              return {
                ok: false,
                errorCode: "MEMORY_RATE_LIMITED",
                summary: "at most 1 global preference can be written per Turn",
              };
            }

            try {
              const memory = this.#options.memory.rememberFromTurn(input, {
                sessionId: session.id,
                turnId: turn.id,
              });

              if (input.scope === "project") projectMemoryWrites += 1;
              else globalMemoryWrites += 1;

              return {
                ok: true,
                summary: `remembered ${memory.scope}/${memory.kind}: ${memory.key} (${memory.status})`,
                data: { memoryId: memory.id, status: memory.status },
              };
            } catch (error) {
              if (error instanceof MemoryError) {
                return { ok: false, errorCode: error.code, summary: error.message };
              }

              return { ok: false, errorCode: "TOOL_ERROR", summary: "memory write failed" };
            }
          },
          readMemory: async (raw) => {
            if (this.#options.memory === undefined || session.projectId === null) {
              return { ok: false, errorCode: "FORBIDDEN", summary: "memory is unavailable" };
            }

            try {
              const result = this.#options.memory.read(
                session.projectId,
                raw as import("@larness/shared").ReadMemoryInput,
              );

              return {
                ok: true,
                summary: `read ${result.items.length} active memories`,
                data: { items: result.items, truncated: result.truncated },
                ...(result.truncated ? { truncated: true } : {}),
              };
            } catch (error) {
              if (error instanceof MemoryError) {
                return { ok: false, errorCode: error.code, summary: error.message };
              }

              return { ok: false, errorCode: "TOOL_ERROR", summary: "memory read failed" };
            }
          },
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
      // The title names the conversation from its opening question, so it
      // fires now — at turn start, before any answer exists — and races the
      // turn instead of delaying it.
      this.#trackTitleWork(
        this.#options.titleSummarizer?.({ session, turn, resolved }) ?? Promise.resolve(),
      );
      const contextWindow =
        resolved.contextWindow ?? resolved.adapter.capabilities.maxContextTokens;
      const inputWindow = Math.min(contextWindow, resolved.maxInputTokens ?? contextWindow);
      // Scale the spend cap with the window reported for this turn: a fixed
      // token cap buys fewer steps on large-context models, which is backwards
      // exactly where long tasks run (ADR-059), but task-level caps are off by
      // default since ADR-071; an explicit positive value still wins.
      const spendCap = resolveSpendCap(this.#budget, contextWindow);
      // The cap covers the whole task, so a continuation inherits what its
      // slices already spent instead of getting a fresh allowance.
      const carriedTokens =
        spendCap > 0 ? carriedSpendTokens(this.#options.db, turn.resumedFromTurnId) : 0;
      const spentTokensTotal = (): number =>
        carriedTokens + (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      const configuredOutputCap = this.#budget.maxOutputTokens;
      const maxOutputTokens =
        resolved.maxOutputTokens === undefined
          ? configuredOutputCap
          : Math.min(
              configuredOutputCap > 0 ? configuredOutputCap : Infinity,
              resolved.maxOutputTokens,
            );
      const contextOptions = {
        db: this.#options.db,
        registry: this.#options.registry,
        maxContextTokens: inputWindow,
        policy,
        contextRatio: this.#budget.contextRatio,
        agentProfile: session.agentProfile,
        ...(this.#options.memory === undefined ? {} : { memory: this.#options.memory }),
        ...(this.#options.attachments === undefined
          ? {}
          : { attachments: this.#options.attachments }),
        modelAcceptsImages: acceptsImagesForTurn(this.#options.db, turn),
        ...(this.#options.attachmentInlineTokens === undefined
          ? {}
          : { attachmentInlineTokens: this.#options.attachmentInlineTokens }),
        ...(this.#options.attachmentContextRatio === undefined
          ? {}
          : { attachmentContextRatio: this.#options.attachmentContextRatio }),
        webSearchAvailable,
        webToolsEnabled,
        now: () => this.#now(),
      };
      let previousPrefix: PrefixSnapshot | null = readPreviousPrefix(this.#options.db, session.id);
      let pendingPrefixBreak: PrefixBreak | null = null;
      const toPrefix = (assembled: ReturnType<typeof assembleContext>): PrefixSnapshot =>
        prefixSnapshot({
          promptVersion: PROMPT_VERSION,
          systemCore: assembled.systemCore,
          instructions: assembled.instructions,
          tools: assembled.tools,
          model: resolved.model,
          firstHistorySeq: assembled.firstHistorySeq,
          prefixTokens: assembled.prefixTokens,
          compacted: assembled.summaryUsed,
          historyTrimmed: assembled.historyTrimmed,
        });
      const assembleStarted = this.#now();
      let context = assembleContext(contextOptions, session, turn);
      let prefixState = toPrefix(context);
      timing.assembleMs += this.#now() - assembleStarted;
      let messages: ModelMessage[] = context.messages;
      const tools: ToolSchema[] = context.tools;

      this.#transition(turn, session, "PREPARING", startedAt);

      const initialBudgetState = checkBudget();

      if (initialBudgetState === "cancel" || initialBudgetState === "shutdown") {
        return await finalizeStop(initialBudgetState);
      }

      this.#transition(turn, session, "RUNNING");

      if (shouldCompress(context.estimatedTokens, inputWindow)) {
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
            inputWindow,
            maxOutputTokens,
            tokensBefore: context.estimatedTokens,
            now: () => this.#now(),
            signal: controller.signal,
            timeoutMs: Math.max(1_000, Math.min(deadline - this.#now(), requestTimeoutMs)),
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
            prefixState = toPrefix(context);
          }
        } catch {
          // Compression is best-effort; keep the truncated context on failure.
        } finally {
          timing.summaryMs += this.#now() - summaryStarted;
        }
      }

      const ensureProjectLock = async (): Promise<boolean> => {
        // A previous STOP_UNCONFIRMED command can outlive its process and block
        // this root forever; confirm it is gone before failing a new Turn.
        await this.#options.commands?.reconcileDeadStoppedCommands();
        if (controller.signal.aborted) {
          return false;
        }

        if (projectLock?.lost) {
          projectLock = null;
        }

        if (acquireProjectLock()) {
          lockLost = false;
          return true;
        }

        const waitMs = this.#options.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS;

        if (waitMs <= 0) {
          return false;
        }

        const until = Date.now() + waitMs;
        const pollMs = Math.max(10, this.#options.lockPollMs ?? DEFAULT_LOCK_POLL_MS);

        while (Date.now() < until) {
          if (controller.signal.aborted || checkBudget() !== "ok") {
            return false;
          }

          await delay(Math.min(pollMs, Math.max(1, until - Date.now())), controller.signal);

          if (controller.signal.aborted) {
            return false;
          }

          if (projectLock?.lost) {
            projectLock = null;
          }

          if (acquireProjectLock()) {
            lockLost = false;
            return true;
          }
        }

        return false;
      };

      const appendLockNotice = () => {
        if (!lockWasLost || lockNoticeSent) {
          return;
        }

        lockNoticeSent = true;
        messages.push({
          role: "user",
          content:
            "The project write lock was lost at least once during this turn. Another writer may have changed files while it was not held. Re-read files and verify repository state before writing; do not rely on earlier reads. Write tools may be rejected while another writer holds the lock.",
        });
      };

      markProgress();

      while (this.#budget.maxSteps === 0 || steps < this.#budget.maxSteps) {
        if (isStalled(lastProgressAt, this.#now(), stallTimeoutMs)) {
          this.#options.logger?.warn(
            {
              turnId,
              sessionId: session.id,
              idleMs: this.#now() - lastProgressAt,
              stallTimeoutMs,
            },
            "turn stalled",
          );
          return await finalize("INTERRUPTED", {
            eventType: "turn.interrupted",
            reason: "stalled",
            message: "No model, tool or plan progress was observed; the task is paused.",
          });
        }

        const budgetState = checkBudget();

        if (budgetState === "cancel" || budgetState === "shutdown") {
          return await finalizeStop(budgetState);
        }

        if (budgetState === "budget") {
          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            budgetExhausted: true,
            budgetCause: "duration",
          });
        }

        if (!renewProjectLock()) {
          dropLock();
        }

        appendLockNotice();

        steps += 1;
        markProgress();
        const assistantMessageId = newId("msg");
        let text = "";
        let reasoning = "";
        const toolRequests: ToolCallRequest[] = [];
        let finishReason: ProviderFinishReason = "other";
        let stepUsage: ProviderUsage | undefined;
        let providerError: ProviderStepFailure | null = null;
        let stepAttempts = 0;

        const stepStartedAt = this.#now();
        let heuristicTokens = estimateRequestTokens(messages, tools);
        let estimatedInputTokens = calibrateEstimate({
          heuristicTokens,
          anchoredHeuristicTokens,
          anchoredProviderTokens,
        });
        const reservedOutput = reservedOutputTokens({
          maxOutputTokens,
          contextWindow,
        });
        let projectedTokens = estimatedInputTokens + reservedOutput;

        // Level-1 compaction: elide older tool bodies before falling back to an
        // irreversible checkpoint. The full results stay in `agent_events`, so
        // the model can re-read anything it still needs.
        if (steps > 0 && shouldFoldToolResults(estimatedInputTokens, inputWindow)) {
          const folded = foldOldToolResults(messages);

          if (folded !== null) {
            messages = folded;
            heuristicTokens = estimateRequestTokens(messages, tools);
            estimatedInputTokens = calibrateEstimate({
              heuristicTokens,
              anchoredHeuristicTokens,
              anchoredProviderTokens,
            });
            projectedTokens = estimatedInputTokens + reservedOutput;
          }
        }

        const watermark = contextWatermark(
          estimatedInputTokens,
          Math.min(inputWindow, contextWindow - reservedOutput),
        );

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
          const screenshots = messages.flatMap((message) =>
            message.role === "user" ? (message.images ?? []) : [],
          );
          // The request that opened the Turn survives compaction verbatim: the
          // checkpoint's 600-character goal is not a substitute for a long
          // specification.
          const pinned = pinnedRequestMessage({
            text: turnInputText(turn.inputJson),
            ...(screenshots.length === 0 ? {} : { images: screenshots }),
          });
          // Keep the immediate working set: the facts say what happened, the
          // last complete batch says what the model was looking at.
          const batch = lastCompleteToolBatch(messages, inputWindow);
          const candidate: ModelMessage[] = [
            messages[0] as ModelMessage,
            ...(pinned === null ? [] : [pinned]),
            checkpointMessage(snapshot, checkpointAt),
            ...(batch === null ? [] : batch.messages),
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
            pendingPrefixBreak = { reason: "history_drop", at: "history" };
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
              reads: snapshot.reads.length,
              failures: snapshot.failures.length,
              openSteps: snapshot.openSteps.length,
              retainedToolBatch: batch === null ? 0 : batch.messages.length - 1,
              pinnedRequestChars: pinned === null ? 0 : turnInputText(turn.inputJson).length,
            });
          }
        }

        // Normal context rollover (ADR-071): the slice hands off before the
        // hard window limit, so a long task is not reported as budget-stopped.
        const rolloverThreshold = contextRolloverThreshold(inputWindow);
        if (steps > 1 && estimatedInputTokens >= rolloverThreshold) {
          const rolloverAt = this.#now();
          const snapshot = facts.snapshot();

          if (!facts.isEmpty()) {
            try {
              const coveredUpToSeq = latestEventSeq(this.#options.db, session.id);
              const saved = saveTurnCheckpoint(this.#options.db, {
                sessionId: session.id,
                turnId: turn.id,
                coveredUpToSeq,
                summary: JSON.stringify(snapshot),
                tokensBefore: heuristicTokens,
                tokensAfter: estimatedInputTokens,
                degraded: false,
                reason: "context_rollover",
                now: rolloverAt,
              });

              this.#emit(turn, session, "context.checkpoint", {
                turnId: turn.id,
                summaryId: saved.id,
                scope: "turn",
                reason: "context_rollover",
                coveredUpToSeq: saved.coveredUpToSeq,
                tokensBefore: heuristicTokens,
                tokensAfter: estimatedInputTokens,
                files: snapshot.files.length,
                reads: snapshot.reads.length,
                failures: snapshot.failures.length,
                openSteps: snapshot.openSteps.length,
                retainedToolBatch: 0,
                pinnedRequestChars: turnInputText(turn.inputJson).length,
              });
            } catch (error) {
              // The events are still the source of truth for the next Turn;
              // a failed summary must not turn a normal rollover into a crash.
              this.#options.logger?.warn(
                { err: error, turnId },
                "context rollover checkpoint failed",
              );
            }
          }

          this.#options.logger?.info(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              estimatedInputTokens,
              rolloverThreshold,
              factsEmpty: facts.isEmpty(),
            },
            "context rollover",
          );

          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            terminalReason: "continued",
          });
        }

        if (projectedTokens > contextWindow || estimatedInputTokens > inputWindow) {
          // Stop honestly instead of letting the provider reject the request.
          return await finalize("COMPLETED", {
            eventType: "turn.completed",
            budgetExhausted: true,
            budgetCause: "context",
          });
        }

        if (spendCap > 0) {
          const spentTokens = spentTokensTotal();

          if (spentTokens >= spendCap) {
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

        while (true) {
          stepAttempts += 1;
          let attemptFailure: ProviderStepFailure | null = null;
          const attemptStartedAt = this.#now();
          const attemptTimeoutMs = Math.max(
            1_000,
            Math.min(deadline - this.#now(), requestTimeoutMs),
          );

          for await (const chunk of resolved.adapter.streamStep({
            model: resolved.model,
            messages,
            tools,
            signal: controller.signal,
            timeoutMs: attemptTimeoutMs,
            ...(maxOutputTokens > 0
              ? {
                  maxOutputTokens: Math.min(
                    maxOutputTokens,
                    Math.max(1, contextWindow - estimatedInputTokens),
                  ),
                }
              : {}),
            maxRetries: 2,
            ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
            ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
            ...(resolved.thinking === undefined ? {} : { thinking: resolved.thinking }),
          })) {
            markProgress();

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

            attemptFailure = {
              code: chunk.error.code,
              message: chunk.error.message,
              ...(chunk.error.statusCode === undefined
                ? {}
                : { statusCode: chunk.error.statusCode }),
            };
            break;
          }

          providerError = attemptFailure;

          if (attemptFailure === null) {
            break;
          }

          const attemptElapsedMs = this.#now() - attemptStartedAt;

          if (
            !shouldRetryProviderStep({
              failure: attemptFailure,
              attempts: stepAttempts,
              emittedOutput:
                text.length > 0 ||
                reasoning.length > 0 ||
                toolRequests.length > 0 ||
                stepUsage !== undefined,
              elapsedMs: attemptElapsedMs,
              remainingMs: deadline - this.#now(),
            })
          ) {
            break;
          }

          const retryDelayMs = providerRetryDelayMs(
            stepAttempts,
            this.#options.providerRetryDelayMs,
          );

          this.#options.logger?.info(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              attempt: stepAttempts + 1,
              delayMs: retryDelayMs,
              elapsedMs: attemptElapsedMs,
              errorCode: attemptFailure.code,
              ...(attemptFailure.statusCode === undefined
                ? {}
                : { statusCode: attemptFailure.statusCode }),
            },
            "provider step retry",
          );

          await delay(retryDelayMs, controller.signal);

          if (controller.signal.aborted) {
            providerError = { code: "PROVIDER_ABORTED", message: "provider request aborted" };
            break;
          }
        }

        usage = addUsage(usage, stepUsage);
        if (stepUsage === undefined) missingUsageSteps += 1;

        if (stepUsage?.inputTokens !== undefined) {
          anchoredHeuristicTokens = heuristicTokens;
          anchoredProviderTokens = stepUsage.inputTokens;
        }

        if (stepUsage !== undefined) {
          const currentPrefix: PrefixSnapshot = {
            ...prefixState,
            ...(stepUsage.cacheReadTokens === undefined
              ? {}
              : { cacheReadTokens: stepUsage.cacheReadTokens }),
          };
          const breakInfo = classifyPrefixBreak({
            previous: previousPrefix,
            current: currentPrefix,
            pending: pendingPrefixBreak,
          });
          previousPrefix = currentPrefix;
          pendingPrefixBreak = null;

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
            durationMs: this.#now() - stepStartedAt,
            usageSource: stepUsage.cacheReadTokens === undefined ? "unknown" : "provider",
            contextWindow: resolved.contextWindow ?? resolved.adapter.capabilities.maxContextTokens,
            promptVersion: currentPrefix.promptVersion,
            systemHash: currentPrefix.systemHash,
            instructionsHash: currentPrefix.instructionsHash,
            toolsetHash: currentPrefix.toolsetHash,
            prefixBreak: breakInfo.reason,
            ...(breakInfo.at === null ? {} : { prefixBreakAt: breakInfo.at }),
            prefixKeptTokens: currentPrefix.prefixKeptTokens,
            ...(currentPrefix.firstHistorySeq === null
              ? {}
              : { firstHistorySeq: currentPrefix.firstHistorySeq }),
          });

          this.#options.logger?.info(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              promptVersion: currentPrefix.promptVersion,
              toolsetHash: currentPrefix.toolsetHash,
              prefixBreak: breakInfo.reason,
              prefixBreakAt: breakInfo.at,
              prefixKeptTokens: currentPrefix.prefixKeptTokens,
              firstHistorySeq: currentPrefix.firstHistorySeq,
              estimatedInputTokens,
              providerInputTokens: stepUsage.inputTokens,
              cacheReadTokens: stepUsage.cacheReadTokens,
            },
            "model prefix usage",
          );
        }

        const afterStep = checkBudget();

        if (afterStep === "cancel" || afterStep === "shutdown") {
          return await finalizeStop(afterStep);
        }

        if (providerError !== null) {
          this.#options.logger?.warn(
            {
              turnId,
              sessionId: session.id,
              step: steps,
              attempts: stepAttempts,
              errorCode: providerError.code,
              ...(providerError.statusCode === undefined
                ? {}
                : { statusCode: providerError.statusCode }),
            },
            "provider step failed",
          );

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
          if (!planNudged) {
            const openSteps = openPlanSteps(this.#options.db, session.id, turn.id);

            if (openSteps.length > 0) {
              planNudged = true;

              if (text.length > 0 || reasoning.length > 0) {
                messages.push({
                  role: "assistant",
                  content: text,
                  ...(reasoning.length === 0 ? {} : { reasoning }),
                });
              }

              messages.push({
                role: "user",
                content: `The plan still has open steps: ${openSteps
                  .map((step) => step.title)
                  .join(
                    "; ",
                  )}. Continue working, or update the plan to mark them done or cancelled if the task is complete. Do not stop with an outdated plan.`,
              });
              this.#options.logger?.info(
                {
                  turnId,
                  sessionId: session.id,
                  step: steps,
                  openSteps: openSteps.length,
                },
                "plan nudge",
              );
              markProgress();
              continue;
            }
          }

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

        // A batch that is nothing but pure reads (L0, lock-free, allowed by the
        // policy) has no ordering constraint, so it runs concurrently: several
        // git reads or searches then cost one round trip instead of their sum.
        // The serial loop below still emits events, checks the budget and
        // appends messages in the original order, and consumes the prefetched
        // outcome instead of executing the call twice.
        const prefetched = new Map<string, ToolExecutionOutcome>();

        const batchToolIndexes: number[] = [];

        if (
          toolRequests.length >= 2 &&
          toolRequests.length <= READ_PREFETCH_LIMIT &&
          checkBudget() === "ok" &&
          toolRequests.every((request) => {
            if (disabledTools.has(request.name)) return false;
            const definition = this.#options.registry.get(request.name);
            if (definition === undefined) return false;
            const risk = definition.classifyRisk?.(request.args) ?? definition.riskLevel;
            return (
              risk === "L0" &&
              definition.requiresProjectLock === false &&
              decideToolAccess(policy, risk) === "allow"
            );
          })
        ) {
          const prefetchStarted = this.#now();
          await Promise.all(
            toolRequests.map(async (request) => {
              try {
                prefetched.set(request.id, await execute(request));
              } catch {
                // Leaving it out makes the serial loop run it again and report
                // the failure through the normal tool path.
              }
            }),
          );
          timing.toolMs += this.#now() - prefetchStarted;
        }

        const repeatedFailureNudges: string[] = [];

        for (const request of toolRequests) {
          const cancelState = checkBudget();

          if (cancelState === "budget")
            return await finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
              budgetCause: "duration",
            });
          if (cancelState === "cancel" || cancelState === "shutdown") {
            return await finalizeStop(cancelState);
          }

          toolCalls += 1;

          if (this.#budget.maxToolCalls > 0 && toolCalls > this.#budget.maxToolCalls) {
            return await finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
              budgetCause: "tool_calls",
            });
          }

          const definition = disabledTools.has(request.name)
            ? undefined
            : this.#options.registry.get(request.name);
          const argsSummary = safeToolSummary(
            definition?.summarize?.(request.args) ?? request.name,
            loadSecrets(),
            this.#options.secretStore,
          );

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
            if (!(await ensureProjectLock())) {
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
          const outcome: ToolExecutionOutcome =
            prefetched.get(request.id) ?? (await execute(request));
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

              return await finalizeStop(this.#stopReason === "shutdown" ? "shutdown" : "cancel");
            }

            this.#emit(turn, session, "tool.approval.resolved", {
              turnId: turn.id,
              approvalId: outcome.approval.id,
              decision,
            });

            if (decision === "approved") {
              approvalId = outcome.approval.id;
              approvedApprovalKeys.add(
                `${outcome.approval.toolName}:${outcome.approval.paramsHash}`,
              );
            } else {
              this.#transition(turn, session, "RUNNING");
            }
          }

          let result: ToolExecutionOutcome = outcome;

          if (outcome.status === "approval_required") {
            if (approvalId !== undefined) {
              if (needsProjectLock && !(await ensureProjectLock())) {
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
              request.name === "apply_patch" ||
              request.name === "write_file" ||
              request.name === "edit"
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
            const target = fileTarget.success && fileResult ? fileTarget.data : undefined;
            const successKey = stableArgsKey(request.name, request.args);
            repeatFailures.delete(successKey);
            const supersededCalls = failedCalls.get(successKey);

            if (supersededCalls !== undefined) failedCalls.delete(successKey);

            if (request.name === "run_command") {
              facts.recordCommand(result.result.summary);
            }

            // A read-only Turn used to record nothing, so it could be neither
            // compacted nor continued. The path and version are the facts a
            // later slice needs to know what was already inspected.
            const readData =
              request.name === "read_file"
                ? (result.result.data as { path?: unknown; version?: unknown } | undefined)
                : undefined;
            const fileRead =
              typeof readData?.path === "string" && typeof readData.version === "string"
                ? { path: readData.path, version: readData.version }
                : undefined;

            if (fileRead !== undefined) {
              facts.recordRead(fileRead.path, fileRead.version);
            }

            facts.recordResource(target);

            const toolContent = toolMessageContent(result.result);
            const replay =
              risk === "L0" &&
              secretVerdict([toolContent], loadSecrets(), this.#options.secretStore) === "ok"
                ? buildToolReplay({
                    toolCallId: request.id,
                    toolName: request.name,
                    args: request.args,
                    content: toolContent,
                  })
                : null;

            this.#emit(turn, session, "tool.completed", {
              turnId: turn.id,
              toolCallId: request.id,
              resultSummary: result.result.summary,
              ...(fileRead === undefined ? {} : { fileRead }),
              ...(target === undefined ? {} : { resourceTarget: target }),
              ...(result.result.truncated === undefined
                ? {}
                : { truncated: result.result.truncated }),
              ...(supersededCalls === undefined ? {} : { supersedes: supersededCalls }),
            });

            if (replay !== null) {
              this.#record(turn, "tool.replay", {
                turnId: turn.id,
                toolCallId: replay.toolCallId,
                toolName: replay.toolName,
                args: replay.args,
                content: replay.content,
                isError: false,
              });
            }

            if (
              request.name === "apply_patch" ||
              request.name === "write_file" ||
              request.name === "edit"
            ) {
              const changed = result.result.data as
                | { path?: unknown; version?: unknown; created?: unknown }
                | undefined;

              if (typeof changed?.path === "string" && typeof changed.version === "string") {
                const changeType =
                  request.name === "write_file" && changed.created === true
                    ? "created"
                    : "modified";
                facts.recordFile(changed.path, changed.version);
                fileChanges.set(changed.path, {
                  path: changed.path,
                  changeType,
                  version: changed.version,
                });
                this.#emit(turn, session, "file.changed", {
                  turnId: turn.id,
                  path: changed.path,
                  changeType,
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

          if (risk !== "L0") {
            const redact = (text: string) =>
              redactOperationText(text, loadSecrets(), this.#options.secretStore);
            const commandData =
              (request.name === "run_command" || request.name === "run_shell") &&
              result.result.data !== undefined
                ? (result.result.data as {
                    exitCode?: unknown;
                    output?: unknown;
                    truncated?: unknown;
                  })
                : undefined;
            const display = commandData === undefined ? undefined : commandDisplay(request.args);
            const displayText =
              display === undefined
                ? undefined
                : "command" in display
                  ? `${display.cwd}$ ${display.command}`
                  : `${display.cwd}$ ${[display.executable, ...display.args].join(" ")}`;
            const safeDisplay = displayText === undefined ? undefined : redact(displayText);
            const outputTail =
              typeof commandData?.output === "string"
                ? commandData.output.slice(-MAX_COMMAND_TAIL_CHARS)
                : undefined;
            const safeTail = outputTail === undefined ? undefined : redact(outputTail);
            const operationCommand =
              commandData === undefined
                ? undefined
                : {
                    display: safeDisplay ?? "[redacted]",
                    exitCode:
                      typeof commandData.exitCode === "number" ? commandData.exitCode : null,
                    ...(safeTail === null || safeTail === undefined
                      ? {}
                      : { outputTail: safeTail }),
                    ...(commandData.truncated === true ? { truncated: true } : {}),
                  };
            const fileData =
              result.result.ok &&
              (request.name === "write_file" ||
                request.name === "edit" ||
                request.name === "apply_patch")
                ? (result.result.data as
                    | {
                        path?: unknown;
                        version?: unknown;
                        created?: unknown;
                        additions?: unknown;
                        deletions?: unknown;
                        replacements?: unknown;
                      }
                    | undefined)
                : undefined;
            const operationFile =
              typeof fileData?.path === "string" &&
              typeof fileData.version === "string" &&
              /^[a-f0-9]{64}$/.test(fileData.version)
                ? {
                    path: fileData.path,
                    version: fileData.version,
                    changeType:
                      request.name === "write_file" && fileData.created === true
                        ? ("created" as const)
                        : ("modified" as const),
                    ...(typeof fileData.additions === "number"
                      ? { additions: fileData.additions }
                      : {}),
                    ...(typeof fileData.deletions === "number"
                      ? { deletions: fileData.deletions }
                      : {}),
                    ...(typeof fileData.replacements === "number"
                      ? { replacements: fileData.replacements }
                      : {}),
                  }
                : undefined;
            const safeSummary = redact(result.result.summary);
            const safeArgsSummary =
              operationCommand?.display ??
              (argsSummary.length === 0 ? undefined : (redact(argsSummary) ?? undefined));
            const operation = buildToolOperation({
              toolCallId: request.id,
              toolName: request.name,
              ok: result.result.ok,
              summary: safeSummary ?? "[redacted]",
              ...(safeArgsSummary === undefined ? {} : { argsSummary: safeArgsSummary }),
              ...(result.result.errorCode === undefined
                ? {}
                : { errorCode: result.result.errorCode }),
              ...(operationCommand === undefined ? {} : { command: operationCommand }),
              ...(operationFile === undefined ? {} : { file: operationFile }),
            });

            try {
              this.#record(turn, "tool.operation", operation as unknown as Record<string, unknown>);
            } catch (error) {
              this.#options.logger?.warn(
                { err: error, turnId, toolCallId: request.id },
                "tool operation record failed",
              );
            }
          }

          batchToolIndexes.push(messages.length);
          messages.push({
            role: "tool",
            toolCallId: request.id,
            toolName: request.name,
            content: toolMessageContent(result.result),
            isError: !result.result.ok,
          });
          markProgress();

          const repeatCount = repeatFailures.get(stableArgsKey(request.name, request.args));

          if (
            !result.result.ok &&
            repeatCount !== undefined &&
            repeatCount === this.#budget.repeatFailureThreshold
          ) {
            repeatedFailureNudges.push(
              `The exact same ${request.name} call with identical arguments has failed ${repeatCount} times in a row and returned the same error. Repeating it will not change the result: change the approach or state what blocks progress.`,
            );
            this.#options.logger?.info(
              { turnId, toolName: request.name, repeatCount },
              "identical tool call keeps failing",
            );
          }
        }

        // The nudge is a user message. Appending it inside the tool loop would
        // split the assistant tool calls from their tool results and produce an
        // invalid transcript for the next provider request.
        for (const nudge of repeatedFailureNudges) {
          messages.push({ role: "user", content: nudge });
        }

        // One step, one budget: a batch of fat results must not spend the whole
        // window. Folding is reversible and keeps the newest result verbatim.
        const boundedBatch = foldBatchToolResults(
          messages,
          batchToolIndexes,
          MAX_BATCH_TOOL_RESULT_TOKENS,
        );

        if (boundedBatch !== null) {
          messages = boundedBatch.messages;
          this.#options.logger?.info(
            { turnId, step: steps, folded: boundedBatch.folded },
            "tool batch folded to its token budget",
          );
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

      const currentStatus = getTurnById(this.#options.db, turnId)?.status;

      if (currentStatus === "CANCELLING") {
        return await finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
      }

      if (controller.signal.aborted) {
        return await finalizeStop(this.#stopReason === "shutdown" ? "shutdown" : "cancel");
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

  /**
   * Persist context material that the next Turn's assembler reads. It is not
   * published: replay bodies are not timeline events, and streaming them would
   * push file contents to every subscriber.
   */
  #record(turn: TurnRow, type: string, payload: Record<string, unknown>): void {
    immediateTransaction(this.#options.db, (tx) =>
      appendAgentEvent(tx, {
        sessionId: turn.sessionId,
        turnId: turn.id,
        type,
        payload,
        now: this.#now(),
      }),
    );
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

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
