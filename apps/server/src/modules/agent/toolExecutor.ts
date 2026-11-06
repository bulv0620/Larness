import {
  type ApprovalPolicy,
  decideToolAccess,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
} from "@larness/agent";
import { OutputRedactor } from "@larness/resources";
import type { Database } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import {
  type ApprovalDto,
  ApprovalError,
  assertApprovalMatches,
  hashApprovalParams,
  requestApproval,
} from "./approvalService.js";

export interface ToolExecutorOptions {
  db: Database;
  registry: ToolRegistry;
  now?: () => number;
}

export interface ExecuteToolInput {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  policy: ApprovalPolicy;
  projectRoot: string;
  ignore?: string[];
  approvalId?: string;
  clientSessionId?: string;
  approvalTtlMs?: number;
  signal?: AbortSignal;
  policySnapshotId?: string;
  updatePlan?: (args: unknown) => Promise<ToolResult>;
  runCommand?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  startTerminal?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  readTerminalOutput?: (args: unknown) => Promise<ToolResult>;
  stopTerminal?: (args: unknown) => Promise<ToolResult>;
  acquireTerminalControl?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  sendTerminalInput?: (args: unknown) => Promise<ToolResult>;
  interruptTerminal?: (args: unknown) => Promise<ToolResult>;
  releaseTerminalControl?: (args: unknown) => Promise<ToolResult>;
  gitRead?: (
    operation: "status" | "diff" | "log" | "branches",
    args: unknown,
  ) => Promise<ToolResult>;
  gitAction?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  registerService?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  listServices?: (args: unknown) => Promise<ToolResult>;
  resolveServicePreview?: (args: unknown) => Promise<ToolResult>;
  listFormalServices?: (args: unknown) => Promise<ToolResult>;
  readFormalServiceLogs?: (args: unknown) => Promise<ToolResult>;
  formalServiceAction?: (args: unknown) => Promise<ToolResult>;
}

export type ToolExecutionOutcome =
  | { status: "completed"; result: ToolResult }
  | { status: "approval_required"; approval: ApprovalDto };

function denied(errorCode: string, message: string): ToolResult {
  return { ok: false, errorCode, summary: message };
}

export async function executeTool(
  options: ToolExecutorOptions,
  input: ExecuteToolInput,
): Promise<ToolExecutionOutcome> {
  const now = options.now?.() ?? Date.now();
  const tool = options.registry.get(input.toolName);

  if (tool === undefined) {
    appendAudit(options.db, {
      action: "tool.denied",
      decision: "deny",
      clientSessionId: input.clientSessionId,
      sessionId: input.sessionId,
      resourceType: "tool",
      resourceId: input.toolCallId,
      details: { turnId: input.turnId, toolName: input.toolName, reason: "unknown_tool" },
      now,
    });
    return {
      status: "completed",
      result: denied("TOOL_NOT_FOUND", `unknown tool: ${input.toolName}`),
    };
  }

  const risk = tool.classifyRisk?.(input.args) ?? tool.riskLevel;
  const access = decideToolAccess(input.policy, risk);

  if (access === "deny") {
    appendAudit(options.db, {
      action: "tool.denied",
      decision: "deny",
      clientSessionId: input.clientSessionId,
      sessionId: input.sessionId,
      resourceType: "tool",
      resourceId: input.toolCallId,
      details: {
        turnId: input.turnId,
        toolName: input.toolName,
        risk,
        policy: input.policy,
        reason: "policy",
      },
      now,
    });
    return {
      status: "completed",
      result: denied("FORBIDDEN", `tool ${input.toolName} is blocked by the approval policy`),
    };
  }

  const parsed = tool.schema.safeParse(input.args);

  if (!parsed.success) {
    appendAudit(options.db, {
      action: "tool.denied",
      decision: "deny",
      clientSessionId: input.clientSessionId,
      sessionId: input.sessionId,
      resourceType: "tool",
      resourceId: input.toolCallId,
      details: {
        turnId: input.turnId,
        toolName: input.toolName,
        reason: "invalid_arguments",
      },
      now,
    });
    return {
      status: "completed",
      result: {
        ok: false,
        errorCode: "VALIDATION_ERROR",
        summary: "invalid tool arguments",
        data: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    };
  }

  const contextBound =
    input.toolName === "run_command" || input.toolName === "start_project_terminal";
  const params = contextBound ? parsed.data : input.args;
  const approvalParams = contextBound
    ? {
        params,
        sessionId: input.sessionId,
        turnId: input.turnId,
        clientSessionId: input.clientSessionId,
        policySnapshotId: input.policySnapshotId,
        policy: input.policy,
        projectRoot: input.projectRoot,
      }
    : params;
  const assertAuthorized = () => {
    if (input.signal?.aborted) throw new ApprovalError("APPROVAL_INVALID", "Execution cancelled");
    if (access === "require_approval" && input.approvalId === undefined)
      throw new ApprovalError("APPROVAL_INVALID", "Approval required");
    if (input.approvalId) {
      const row = assertApprovalMatches(
        { db: options.db, now: options.now, clientSessionId: input.clientSessionId },
        { id: input.approvalId, params: approvalParams },
      );
      if (
        row.turnId !== input.turnId ||
        row.toolCallId !== input.toolCallId ||
        row.toolName !== input.toolName
      )
        throw new ApprovalError("APPROVAL_INVALID", "Approval identity mismatch");
    }
  };
  if (access === "require_approval" && input.approvalId === undefined) {
    const approval = requestApproval(
      { db: options.db, now: () => now },
      {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        risk,
        scope: {
          summary: contextBound
            ? `${summarizeTool(tool, params)}\n${new OutputRedactor([]).push(JSON.stringify(params), true)}`
            : summarizeTool(tool, params),
          risk,
          toolName: input.toolName,
        },
        params: approvalParams,
        clientSessionId: input.clientSessionId,
        ...(input.approvalTtlMs === undefined ? {} : { ttlMs: input.approvalTtlMs }),
      },
    );

    appendAudit(options.db, {
      action: "tool.requested",
      decision: "info",
      clientSessionId: input.clientSessionId,
      sessionId: input.sessionId,
      resourceType: "tool",
      resourceId: input.toolCallId,
      details: {
        turnId: input.turnId,
        toolName: input.toolName,
        risk,
        approvalId: approval.id,
      },
      now,
    });

    return { status: "approval_required", approval };
  }

  if (input.approvalId !== undefined) {
    try {
      const approval = assertApprovalMatches(
        { db: options.db, now: () => now, clientSessionId: input.clientSessionId },
        { id: input.approvalId, params: approvalParams },
      );

      if (
        approval.turnId !== input.turnId ||
        approval.toolCallId !== input.toolCallId ||
        approval.toolName !== input.toolName
      ) {
        throw new ApprovalError("APPROVAL_INVALID", "approval does not match the tool call");
      }
    } catch (error) {
      if (error instanceof ApprovalError) {
        appendAudit(options.db, {
          action: "tool.denied",
          decision: "deny",
          clientSessionId: input.clientSessionId,
          sessionId: input.sessionId,
          resourceType: "tool",
          resourceId: input.toolCallId,
          details: {
            turnId: input.turnId,
            toolName: input.toolName,
            approvalId: input.approvalId,
            reason: error.code,
          },
          now,
        });
        return {
          status: "completed",
          result: denied(error.code, error.message),
        };
      }

      throw error;
    }
  }

  appendAudit(options.db, {
    action: "tool.requested",
    decision: "allow",
    clientSessionId: input.clientSessionId,
    sessionId: input.sessionId,
    resourceType: "tool",
    resourceId: input.toolCallId,
    details: {
      turnId: input.turnId,
      toolName: input.toolName,
      risk,
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
    },
    now,
  });

  const context: ToolContext = {
    ...(input.updatePlan
      ? {
          updatePlan: async (args: unknown) => {
            assertAuthorized();
            return input.updatePlan?.(args) ?? denied("FORBIDDEN", "Plan context unavailable");
          },
        }
      : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.runCommand
      ? {
          runCommand: async (args: unknown) => {
            if (hashApprovalParams(args) !== hashApprovalParams(params))
              return denied("APPROVAL_INVALID", "Command parameters changed");
            assertAuthorized();
            return (
              input.runCommand?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Command context unavailable")
            );
          },
        }
      : {}),
    ...(input.startTerminal
      ? {
          startTerminal: async (args: unknown) => {
            if (hashApprovalParams(args) !== hashApprovalParams(params))
              return denied("APPROVAL_INVALID", "Terminal parameters changed");
            assertAuthorized();
            return (
              input.startTerminal?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Terminal context unavailable")
            );
          },
        }
      : {}),
    ...(input.registerService
      ? {
          registerService: async (args: unknown) => {
            if (hashApprovalParams(args) !== hashApprovalParams(params))
              return denied("APPROVAL_INVALID", "Service parameters changed");
            assertAuthorized();
            return (
              input.registerService?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Service context unavailable")
            );
          },
        }
      : {}),
    ...(input.listServices
      ? {
          listServices: async (args: unknown) => {
            assertAuthorized();
            return input.listServices?.(args) ?? denied("FORBIDDEN", "Service context unavailable");
          },
        }
      : {}),
    ...(input.readTerminalOutput
      ? {
          readTerminalOutput: async (args: unknown) => {
            assertAuthorized();
            return (
              input.readTerminalOutput?.(args) ??
              denied("FORBIDDEN", "Terminal read context unavailable")
            );
          },
        }
      : {}),
    ...(input.stopTerminal
      ? {
          stopTerminal: async (args: unknown) => {
            assertAuthorized();
            return (
              input.stopTerminal?.(args) ?? denied("FORBIDDEN", "Terminal stop context unavailable")
            );
          },
        }
      : {}),
    ...(input.acquireTerminalControl
      ? {
          acquireTerminalControl: async (args: unknown) => {
            assertAuthorized();
            return (
              input.acquireTerminalControl?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Terminal control context unavailable")
            );
          },
        }
      : {}),
    ...(input.sendTerminalInput
      ? {
          sendTerminalInput: async (args: unknown) => {
            assertAuthorized();
            return (
              input.sendTerminalInput?.(args) ??
              denied("FORBIDDEN", "Terminal input context unavailable")
            );
          },
        }
      : {}),
    ...(input.interruptTerminal
      ? {
          interruptTerminal: async (args: unknown) => {
            assertAuthorized();
            return (
              input.interruptTerminal?.(args) ??
              denied("FORBIDDEN", "Terminal interrupt context unavailable")
            );
          },
        }
      : {}),
    ...(input.releaseTerminalControl
      ? {
          releaseTerminalControl: async (args: unknown) => {
            assertAuthorized();
            return (
              input.releaseTerminalControl?.(args) ??
              denied("FORBIDDEN", "Terminal release context unavailable")
            );
          },
        }
      : {}),
    ...(input.gitRead
      ? {
          gitRead: async (operation, args) => {
            assertAuthorized();
            return (
              input.gitRead?.(operation, args) ??
              denied("FORBIDDEN", "Git read context unavailable")
            );
          },
        }
      : {}),
    ...(input.gitAction
      ? {
          gitAction: async (args: unknown) => {
            assertAuthorized();
            return (
              input.gitAction?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Git action context unavailable")
            );
          },
        }
      : {}),
    projectRoot: input.projectRoot,
    ...(input.ignore === undefined ? {} : { ignore: input.ignore }),
  };
  const result = await options.registry.execute(input.toolName, params, context);

  appendAudit(options.db, {
    action: result.ok ? "tool.completed" : "tool.denied",
    decision: result.ok ? "allow" : "deny",
    clientSessionId: input.clientSessionId,
    sessionId: input.sessionId,
    resourceType: "tool",
    resourceId: input.toolCallId,
    details: {
      turnId: input.turnId,
      toolName: input.toolName,
      summary: result.summary,
      ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
      ...(result.truncated === undefined ? {} : { truncated: result.truncated }),
    },
    now,
  });

  return { status: "completed", result };
}

function summarizeTool(tool: ToolDefinition, args: unknown): string {
  return tool.summarize?.(args) ?? tool.name;
}
