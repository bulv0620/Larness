import { realpath } from "node:fs/promises";
import {
  type ApprovalPolicy,
  decideToolAccess,
  type ModelMessage,
  type ProviderAdapter,
  ProviderError,
  type ProviderFinishReason,
  type ProviderUsage,
  type ToolCallRequest,
  type ToolRegistry,
  type ToolSchema,
} from "@larness/agent";
import type { AssistantDeltaEvent, ServerEvent } from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { SessionRow, TurnRow, TurnStatus } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { publishAgentEvent } from "../../ws/publisher.js";
import { getProjectById } from "../projects/repository.js";
import { getSessionById, getTurnById, updateTurnRow } from "../sessions/repository.js";
import { type ApprovalDto, getApproval } from "./approvalService.js";
import { assembleContext } from "./contextAssembler.js";
import { appendAgentEvent, toServerEvent } from "./events.js";
import { ProjectWriteLock } from "./projectWriteLock.js";
import { executeTool, type ToolExecutionOutcome } from "./toolExecutor.js";

const DEFAULT_BUDGET = {
  maxSteps: 30,
  maxToolCalls: 50,
  maxDurationMs: 10 * 60_000,
  contextRatio: 0.8,
} as const;

const APPROVAL_POLL_MS = 100;
const MAX_TOOL_MESSAGE_CHARS = 20_000;
const MAX_TOOL_MESSAGE_LINES = 1_000;

export interface ResolvedProvider {
  adapter: ProviderAdapter;
  model: string;
  apiKey?: string;
  endpoint?: string;
}

export type ProviderResolver = (
  session: SessionRow,
  turn: TurnRow,
) => ResolvedProvider | Promise<ResolvedProvider>;

export interface TurnBudget {
  maxSteps: number;
  maxToolCalls: number;
  maxDurationMs: number;
  contextRatio: number;
}

export interface TurnRunnerOptions {
  db: Database;
  registry: ToolRegistry;
  resolveProvider: ProviderResolver;
  publish?: (event: ServerEvent | AssistantDeltaEvent) => void;
  now?: () => number;
  budget?: Partial<TurnBudget>;
  approvalPollMs?: number;
  approvalTtlMs?: number;
  lockTtlMs?: number;
}

export type TurnRunResult = {
  status: TurnStatus;
  errorCode?: string;
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
  return value === "strict" || value === "readonly" ? value : "standard";
}

function truncateToolMessage(text: string): string {
  const lines = text.split(/\r?\n/);

  if (lines.length > MAX_TOOL_MESSAGE_LINES) {
    return `${lines.slice(0, MAX_TOOL_MESSAGE_LINES).join("\n")}\n...[truncated]`;
  }

  if (text.length > MAX_TOOL_MESSAGE_CHARS) {
    return `${text.slice(0, MAX_TOOL_MESSAGE_CHARS)}...[truncated]`;
  }

  return text;
}

function toolMessageContent(result: {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
}): string {
  const value = result.ok
    ? JSON.stringify(result.data ?? { summary: result.summary })
    : JSON.stringify({ errorCode: result.errorCode ?? "TOOL_ERROR", message: result.summary });

  return truncateToolMessage(value);
}

function addUsage(total: ProviderUsage, next: ProviderUsage | undefined): ProviderUsage {
  if (next === undefined) {
    return total;
  }

  return {
    inputTokens: (total.inputTokens ?? 0) + (next.inputTokens ?? 0),
    outputTokens: (total.outputTokens ?? 0) + (next.outputTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (next.totalTokens ?? 0),
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
    const project =
      session.projectId === null ? null : getProjectById(this.#options.db, session.projectId);
    let projectRoot = project?.realPath ?? session.workspacePath;
    const policy = approvalPolicy(session.approvalPolicyId);
    let projectLock: ProjectWriteLock | null = null;
    let usage: ProviderUsage = {};
    let steps = 0;
    let toolCalls = 0;
    let finalized = false;

    const finalize = (
      status: TurnStatus,
      options: {
        eventType: string;
        errorCode?: string;
        message?: string;
        reason?: string;
        budgetExhausted?: boolean;
        finishReason?: ProviderFinishReason;
      },
    ): TurnRunResult => {
      finalized = true;
      return this.#finalize(turn, session, status, {
        ...options,
        usage,
        durationMs: this.#now() - startedAt,
      });
    };

    const checkBudget = (): "ok" | "cancel" | "budget" => {
      if (controller.signal.aborted) {
        return "cancel";
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

    const renewProjectLock = (): boolean => projectLock === null || projectLock.renew() !== null;

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
      const context = assembleContext(
        {
          db: this.#options.db,
          registry: this.#options.registry,
          maxContextTokens: resolved.adapter.capabilities.maxContextTokens,
          contextRatio: this.#budget.contextRatio,
        },
        session,
        turn,
      );
      const messages: ModelMessage[] = context.messages;
      const tools: ToolSchema[] = context.tools;

      this.#transition(turn, session, "PREPARING", startedAt);

      if (checkBudget() === "cancel") {
        return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
      }

      this.#transition(turn, session, "RUNNING");

      while (steps < this.#budget.maxSteps) {
        const budgetState = checkBudget();

        if (budgetState === "cancel") {
          return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
        }

        if (budgetState === "budget") {
          return finalize("COMPLETED", { eventType: "turn.completed", budgetExhausted: true });
        }

        if (!renewProjectLock()) {
          return finalize("FAILED", {
            eventType: "turn.failed",
            errorCode: "RESOURCE_LOCKED",
            message: "project write lock was lost",
          });
        }

        steps += 1;
        const assistantMessageId = newId("msg");
        let text = "";
        const toolRequests: ToolCallRequest[] = [];
        let finishReason: ProviderFinishReason = "other";
        let stepUsage: ProviderUsage | undefined;
        let providerError: { code: string; message: string } | null = null;

        for await (const chunk of resolved.adapter.streamStep({
          model: resolved.model,
          messages,
          tools,
          signal: controller.signal,
          ...(resolved.apiKey === undefined ? {} : { apiKey: resolved.apiKey }),
          ...(resolved.endpoint === undefined ? {} : { endpoint: resolved.endpoint }),
        })) {
          if (chunk.type === "text-delta") {
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

        const afterStep = checkBudget();

        if (afterStep === "cancel") {
          return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
        }

        if (providerError !== null) {
          if (providerError.code === "PROVIDER_ABORTED") {
            return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
          }

          return finalize("FAILED", {
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
          return finalize("COMPLETED", {
            eventType: "turn.completed",
            finishReason,
          });
        }

        messages.push({ role: "assistant", content: text, toolCalls: toolRequests });

        for (const request of toolRequests) {
          const cancelState = checkBudget();

          if (cancelState === "cancel") {
            return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
          }

          toolCalls += 1;

          if (toolCalls > this.#budget.maxToolCalls) {
            return finalize("COMPLETED", {
              eventType: "turn.completed",
              budgetExhausted: true,
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
          const access =
            definition === undefined ? "allow" : decideToolAccess(policy, definition.riskLevel);
          const needsProjectLock =
            definition !== undefined && definition.riskLevel !== "L0" && session.projectId !== null;

          if (needsProjectLock && access !== "require_approval") {
            if (!acquireProjectLock() || !renewProjectLock()) {
              const result = {
                ok: false,
                errorCode: "RESOURCE_LOCKED",
                summary: "project is locked by another writer",
              };
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

          const outcome: ToolExecutionOutcome = await this.#execute(
            turn,
            session,
            request,
            policy,
            projectRoot,
          );

          if (outcome.status === "approval_required") {
            this.#transition(turn, session, "WAITING_APPROVAL");
            this.#emit(turn, session, "tool.approval.required", {
              turnId: turn.id,
              toolCallId: request.id,
              approvalId: outcome.approval.id,
              toolName: request.name,
              risk: definition?.riskLevel ?? "L1",
              summary:
                typeof (outcome.approval.scope as { summary?: unknown }).summary === "string"
                  ? (outcome.approval.scope as { summary: string }).summary
                  : request.name,
              scope: outcome.approval.scope,
              expiresAt: outcome.approval.expiresAt,
            });

            const decision = await this.#waitForApproval(outcome.approval, controller.signal);

            if (decision === "cancelled") {
              return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
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
                result = await this.#execute(
                  turn,
                  session,
                  request,
                  policy,
                  projectRoot,
                  approvalId,
                );
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
            return finalize("FAILED", {
              eventType: "turn.failed",
              errorCode: "APPROVAL_INVALID",
              message: "approval was requested twice for one tool call",
            });
          }

          if (result.result.ok) {
            this.#emit(turn, session, "tool.completed", {
              turnId: turn.id,
              toolCallId: request.id,
              resultSummary: result.result.summary,
              ...(result.result.truncated === undefined
                ? {}
                : { truncated: result.result.truncated }),
            });

            if (request.name === "apply_patch") {
              const changed = result.result.data as
                | { path?: unknown; version?: unknown }
                | undefined;

              if (typeof changed?.path === "string" && typeof changed.version === "string") {
                this.#emit(turn, session, "file.changed", {
                  turnId: turn.id,
                  path: changed.path,
                  changeType: "modified",
                  version: changed.version,
                });
              }
            }
          } else {
            this.#emit(turn, session, "tool.failed", {
              turnId: turn.id,
              toolCallId: request.id,
              errorCode: result.result.errorCode ?? "TOOL_ERROR",
              message: result.result.summary,
            });
          }

          messages.push({
            role: "tool",
            toolCallId: request.id,
            toolName: request.name,
            content: toolMessageContent(result.result),
            isError: !result.result.ok,
          });
        }
      }

      return finalize("COMPLETED", { eventType: "turn.completed", budgetExhausted: true });
    } catch (error) {
      if (finalized) {
        throw error;
      }

      if (
        controller.signal.aborted ||
        getTurnById(this.#options.db, turnId)?.status === "CANCELLING"
      ) {
        return finalize("CANCELLED", { eventType: "turn.cancelled", reason: "user" });
      }

      if (error instanceof ProviderError) {
        return finalize("FAILED", {
          eventType: "turn.failed",
          errorCode: error.code,
          message: error.message,
        });
      }

      const message = error instanceof Error ? error.message : String(error);
      return finalize("FAILED", {
        eventType: "turn.failed",
        errorCode: "INTERNAL",
        message: message.slice(0, 500),
      });
    } finally {
      (projectLock as ProjectWriteLock | null)?.release();
      this.#controllers.delete(turnId);
    }
  }

  #execute(
    turn: TurnRow,
    session: SessionRow,
    request: ToolCallRequest,
    policy: ApprovalPolicy,
    projectRoot: string,
    approvalId?: string,
  ): Promise<ToolExecutionOutcome> {
    return executeTool(
      {
        db: this.#options.db,
        registry: this.#options.registry,
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
        ...(approvalId === undefined ? {} : { approvalId }),
        ...(this.#options.approvalTtlMs === undefined
          ? {}
          : { approvalTtlMs: this.#options.approvalTtlMs }),
      },
    );
  }

  async #waitForApproval(
    approval: ApprovalDto,
    signal: AbortSignal,
  ): Promise<"approved" | "denied" | "expired" | "cancelled"> {
    const pollMs = this.#options.approvalPollMs ?? APPROVAL_POLL_MS;

    while (!signal.aborted) {
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

      await delay(Math.min(pollMs, current.expiresAt - now), signal);
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
      finishReason?: ProviderFinishReason;
      usage?: ProviderUsage;
      durationMs?: number;
    },
  ): TurnRunResult {
    const now = this.#now();
    const errorJson =
      options.errorCode === undefined
        ? null
        : JSON.stringify({ code: options.errorCode, message: options.message ?? "" });
    let eventRow: ReturnType<typeof appendAgentEvent> | null = null;

    immediateTransaction(this.#options.db, (tx) => {
      updateTurnRow(tx, turn.id, {
        status,
        endedAt: now,
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
          ...(options.finishReason === undefined ? {} : { finishReason: options.finishReason }),
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
          ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
          ...(options.budgetExhausted === undefined
            ? {}
            : { budgetExhausted: options.budgetExhausted }),
        },
        now,
      });
    });

    this.#publish(eventRow, session);

    return {
      status,
      ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode }),
    };
  }

  #publishDelta(turn: TurnRow, session: SessionRow, event: AssistantDeltaEvent): void {
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
