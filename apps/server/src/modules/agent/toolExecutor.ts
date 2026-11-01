import {
  type ApprovalPolicy,
  decideToolAccess,
  type ToolDefinition,
  type ToolRegistry,
  type ToolResult,
} from "@larness/agent";
import type { Database } from "../../db/client.js";
import { appendAudit } from "../../db/repositories/audit.js";
import {
  type ApprovalDto,
  ApprovalError,
  assertApprovalMatches,
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

  const access = decideToolAccess(input.policy, tool.riskLevel);

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
        risk: tool.riskLevel,
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

  if (access === "require_approval" && input.approvalId === undefined) {
    const approval = requestApproval(
      { db: options.db, now: () => now },
      {
        turnId: input.turnId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        risk: tool.riskLevel,
        scope: {
          summary: summarizeTool(tool, input.args),
          risk: tool.riskLevel,
          toolName: input.toolName,
        },
        params: input.args,
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
        risk: tool.riskLevel,
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
        { id: input.approvalId, params: input.args },
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
      risk: tool.riskLevel,
      ...(input.approvalId === undefined ? {} : { approvalId: input.approvalId }),
    },
    now,
  });

  const result = await options.registry.execute(input.toolName, input.args, {
    projectRoot: input.projectRoot,
    ...(input.ignore === undefined ? {} : { ignore: input.ignore }),
  });

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
