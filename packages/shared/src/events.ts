import type { FileResultTarget } from "./files";
export type EventTopic = "agent" | "terminal" | "service" | "git" | "file" | "system";

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
}

export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  status: "pending" | "running" | "done" | "failed";
}

export interface PlanItem {
  id: string;
  kind: "plan";
  title: string;
  steps: PlanStep[];
  createdAt: number;
}

export interface ToolItem {
  id: string;
  kind: "tool";
  name: string;
  summary: string;
  args: string;
  status: "running" | "done" | "error";
  output?: string;
  durationMs?: number;
  resourceTarget?: FileResultTarget;
  createdAt: number;
}

export interface ApprovalItem {
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
  id: string;
  kind: "artifact";
  title: string;
  description: string;
  meta: string;
  href?: string;
  resourceTarget?: FileResultTarget;
  createdAt: number;
}

export interface ErrorItem {
  id: string;
  kind: "error";
  message: string;
  createdAt: number;
}

export type TimelineItem =
  | MessageItem
  | PlanItem
  | ToolItem
  | ApprovalItem
  | ArtifactItem
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
