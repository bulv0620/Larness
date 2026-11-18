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
import { AuditSink } from "../audit/sink.js";
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
  startProcess?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  readProcessOutput?: (args: unknown) => Promise<ToolResult>;
  stopProcess?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  startService?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  readServiceLogs?: (args: unknown) => Promise<ToolResult>;
  stopService?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  registerService?: (args: unknown, assertAuthorized: () => void) => Promise<ToolResult>;
  listServices?: (args: unknown) => Promise<ToolResult>;
  resolveServicePreview?: (args: unknown) => Promise<ToolResult>;
  refreshObservations?: () => Promise<ToolResult>;
  loadSecrets?: () => import("@larness/agent").EncryptedSecretRef[];
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
  const audit = new AuditSink({ db: options.db, now: () => now });
  const tool = options.registry.get(input.toolName);

  if (tool === undefined) {
    audit.required({
      action: "tool.denied",
      decision: "deny",
      clientSessionId: input.clientSessionId,
      sessionId: input.sessionId,
      resourceType: "tool",
      resourceId: input.toolCallId,
      details: { turnId: input.turnId, toolName: input.toolName, reason: "unknown_tool" },
    });
    return {
      status: "completed",
      result: denied("TOOL_NOT_FOUND", `unknown tool: ${input.toolName}`),
    };
  }

  const risk = tool.classifyRisk?.(input.args) ?? tool.riskLevel;
  const access = decideToolAccess(input.policy, risk);

  if (access === "deny") {
    audit.required({
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
    });
    return {
      status: "completed",
      result: denied("FORBIDDEN", `tool ${input.toolName} is blocked by the approval policy`),
    };
  }

  const parsed = tool.schema.safeParse(input.args);

  if (!parsed.success) {
    audit.required({
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
    });
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    // Name the first offending field so the model and the user can act on it
    // without digging into the structured issues.
    const first = issues[0];
    const detail =
      first === undefined
        ? ""
        : `: ${first.path.length > 0 ? first.path : "<arguments>"} — ${first.message}`;

    return {
      status: "completed",
      result: {
        ok: false,
        errorCode: "VALIDATION_ERROR",
        summary: `invalid tool arguments${detail}`.slice(0, 300),
        data: { issues },
      },
    };
  }

  const contextBound =
    input.toolName === "run_command" ||
    input.toolName === "run_shell" ||
    input.toolName === "start_process" ||
    input.toolName === "stop_process" ||
    input.toolName === "start_service" ||
    input.toolName === "stop_service";
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
        audit.required({
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
        });
        return {
          status: "completed",
          result: denied(error.code, error.message),
        };
      }

      throw error;
    }
  }

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
    ...(input.startProcess
      ? {
          startProcess: async (args: unknown) => {
            if (hashApprovalParams(args) !== hashApprovalParams(params))
              return denied("APPROVAL_INVALID", "Process parameters changed");
            assertAuthorized();
            return (
              input.startProcess?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Process context unavailable")
            );
          },
        }
      : {}),
    ...(input.readProcessOutput
      ? {
          readProcessOutput: async (args: unknown) => {
            assertAuthorized();
            return (
              input.readProcessOutput?.(args) ??
              denied("FORBIDDEN", "Process output context unavailable")
            );
          },
        }
      : {}),
    ...(input.stopProcess
      ? {
          stopProcess: async (args: unknown) => {
            assertAuthorized();
            return (
              input.stopProcess?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Process stop context unavailable")
            );
          },
        }
      : {}),
    ...(input.startService
      ? {
          startService: async (args: unknown) => {
            if (hashApprovalParams(args) !== hashApprovalParams(params))
              return denied("APPROVAL_INVALID", "Service parameters changed");
            assertAuthorized();
            return (
              input.startService?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Service context unavailable")
            );
          },
        }
      : {}),
    ...(input.readServiceLogs
      ? {
          readServiceLogs: async (args: unknown) => {
            assertAuthorized();
            return (
              input.readServiceLogs?.(args) ??
              denied("FORBIDDEN", "Service log context unavailable")
            );
          },
        }
      : {}),
    ...(input.stopService
      ? {
          stopService: async (args: unknown) => {
            assertAuthorized();
            return (
              input.stopService?.(args, assertAuthorized) ??
              denied("FORBIDDEN", "Service stop context unavailable")
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
    ...(input.resolveServicePreview
      ? {
          resolveServicePreview: async (args: unknown) => {
            assertAuthorized();
            return (
              input.resolveServicePreview?.(args) ??
              denied("FORBIDDEN", "Service context unavailable")
            );
          },
        }
      : {}),
    ...(input.loadSecrets ? { loadSecrets: input.loadSecrets } : {}),
    ...(input.refreshObservations
      ? {
          refreshObservations: async () => {
            assertAuthorized();
            return (
              input.refreshObservations?.() ??
              denied("FORBIDDEN", "Observation context unavailable")
            );
          },
        }
      : {}),
    projectRoot: input.projectRoot,
    ...(input.ignore === undefined ? {} : { ignore: input.ignore }),
  };
  const result = await options.registry.execute(input.toolName, params, context);

  const auditInput = {
    action: result.ok ? "tool.completed" : "tool.denied",
    decision: result.ok ? ("allow" as const) : ("deny" as const),
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
  };
  if (result.ok) audit.debug(auditInput);
  else audit.required(auditInput);

  return { status: "completed", result };
}

function summarizeTool(tool: ToolDefinition, args: unknown): string {
  return tool.summarize?.(args) ?? tool.name;
}
