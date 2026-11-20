import { z } from "zod";
import type { ResourceTarget } from "./terminals";

export const WORKSPACE_SESSIONS_CHANGED = "workspace.sessions.changed";
export const WORKSPACE_JOBS_CHANGED = "workspace.jobs.changed";
export const WORKSPACE_MEMORY_CHANGED = "memory.changed";

export const WorkspaceSessionNotificationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("subscribed"),
    subscription: z.object({ topic: z.literal("system"), resourceId: z.literal("system") }),
  }),
  z.object({ kind: z.literal(WORKSPACE_SESSIONS_CHANGED) }),
]);

export const WorkspaceJobsNotificationSchema = z.object({
  kind: z.literal(WORKSPACE_JOBS_CHANGED),
});

export const WorkspaceMemoryNotificationSchema = z.object({
  kind: z.literal(WORKSPACE_MEMORY_CHANGED),
  scope: z.enum(["project", "global"]),
  projectId: z.string().optional(),
  memoryId: z.string(),
  action: z.enum(["learned", "updated", "reviewed", "forgotten", "evicted", "restored", "purged"]),
  status: z.enum(["active", "review", "rejected", "superseded", "expired", "evicted"]),
});

export type EventTopic =
  | "command"
  | "agent"
  | "terminal"
  | "service"
  | "service-ops"
  | "git"
  | "file"
  | "system";

export interface ServerEvent<T = unknown> {
  kind: "event";
  eventId: string;
  protocolVersion: 1;
  topic: EventTopic;
  streamId: string;
  projectId?: string;
  sessionId?: string;
  resourceId?: string;
  sequence: number;
  timestamp: number;
  type: string;
  payload: T;
}

export interface AssistantReasoningDeltaEvent {
  kind: "assistant.reasoning.delta";
  protocolVersion: 1;
  topic: "agent";
  streamId: string;
  sessionId: string;
  turnId: string;
  messageId: string;
  text: string;
  timestamp: number;
}

export interface AssistantDeltaEvent {
  kind: "assistant.delta";
  protocolVersion: 1;
  topic: "agent";
  streamId: string;
  sessionId: string;
  turnId: string;
  messageId: string;
  text: string;
  timestamp: number;
}

export type TurnTerminalReason =
  | "normal"
  | "continued"
  | "budget"
  | "output_truncated"
  | "provider_error"
  | "error"
  | "cancelled"
  | "interrupted";

/**
 * Which budget ended a turn (ADR-059). Since ADR-071 task-level budgets are
 * disabled by default; `tokens` / `context` remain continuable when a caller
 * explicitly enables a cap.
 */
export type TurnBudgetCause = "duration" | "tokens" | "context" | "steps" | "tool_calls";

export const TURN_BUDGET_CAUSES: readonly TurnBudgetCause[] = [
  "duration",
  "tokens",
  "context",
  "steps",
  "tool_calls",
];

export const TurnFileResultSchema = z.object({
  path: z.string().min(1),
  changeType: z.enum(["created", "modified"]),
  version: z.string().min(1),
  existed: z.boolean(),
  category: z.enum(["deliverable", "process"]),
});

export type TurnFileResult = z.infer<typeof TurnFileResultSchema>;

export const TurnFileResultsSchema = z.array(TurnFileResultSchema);

export interface MessageItem {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  turnId?: string;
  screenshots?: { sessionId: string; ids: string[] };
  streaming?: boolean;
  turnOutcome?: "completed" | "failed" | "cancelled" | "interrupted";
  terminalReason?: TurnTerminalReason;
  /** Which budget ended this slice; absent on turns that ran before ADR-059 or after ADR-071 defaults. */
  budgetCause?: TurnBudgetCause;
  durationMs?: number;
  /** Per-file disposition emitted with the terminal event; absent on old turns. */
  fileResults?: TurnFileResult[];
  /** Files beyond the per-turn cap that were not listed. */
  fileResultsOmitted?: number;
}

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "running" | "done" | "failed";
}

export interface PlanItem {
  turnId?: string;
  id: string;
  kind: "plan";
  title: string;
  steps: PlanStep[];
  createdAt: number;
}

export interface ToolItem {
  turnId?: string;
  id: string;
  kind: "tool";
  name: string;
  summary: string;
  args: string;
  status: "running" | "done" | "error";
  /** This failed attempt was later retried with identical arguments and succeeded. */
  retried?: boolean;
  output?: string;
  durationMs?: number;
  commandId?: string;
  commandLabel?: string;
  resourceTarget?: ResourceTarget;
  createdAt: number;
}

export interface ApprovalItem {
  turnId?: string;
  id: string;
  kind: "approval";
  serviceName?: string;
  port?: number;
  version?: string;
  impact?: string;
  toolName?: string;
  summary?: string;
  risk?: string;
  scope?: unknown;
  expiresAt?: number;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface ArtifactItem {
  turnId?: string;
  id: string;
  kind: "artifact";
  title: string;
  description: string;
  meta: string;
  href?: string;
  resourceTarget?: ResourceTarget;
  createdAt: number;
}

export interface ErrorItem {
  turnId?: string;
  id: string;
  kind: "error";
  message: string;
  createdAt: number;
}

export interface ReasoningItem {
  turnId?: string;
  id: string;
  kind: "reasoning";
  text: string;
  streaming?: boolean;
  createdAt: number;
}

export type TimelineItem =
  | MessageItem
  | PlanItem
  | ToolItem
  | ApprovalItem
  | ArtifactItem
  | ReasoningItem
  | ErrorItem;

export type TurnEvent =
  | { type: "message.user"; item: MessageItem }
  | { type: "message.delta"; id: string; text: string }
  | { type: "message.assistant"; item: MessageItem }
  | { type: "plan"; item: PlanItem }
  | { type: "tool"; item: ToolItem }
  | { type: "tool.update"; id: string; patch: Partial<ToolItem> }
  | { type: "approval"; item: ApprovalItem }
  | { type: "approval.update"; id: string; status: ApprovalItem["status"] }
  | { type: "artifact"; item: ArtifactItem }
  | { type: "error"; item: ErrorItem }
  | { type: "turn.done" };
