import { z } from "zod";
import type { ResourceTarget } from "./terminals";

export const WORKSPACE_SESSIONS_CHANGED = "workspace.sessions.changed";
export const WORKSPACE_JOBS_CHANGED = "workspace.jobs.changed";

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

export interface MessageItem {
  id: string;
  kind: "message";
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  turnId?: string;
  streaming?: boolean;
  turnOutcome?: "completed" | "failed" | "cancelled" | "interrupted";
  durationMs?: number;
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
