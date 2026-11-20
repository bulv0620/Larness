import { EventEmitter } from "node:events";
import {
  type AssistantDeltaEvent,
  type AssistantReasoningDeltaEvent,
  type MemoryChangedPayload,
  type ServerEvent,
  WORKSPACE_JOBS_CHANGED,
  WORKSPACE_MEMORY_CHANGED,
  WORKSPACE_SESSIONS_CHANGED,
} from "@larness/shared";

class AgentEventBus extends EventEmitter {}

export const agentEventBus = new AgentEventBus();
agentEventBus.setMaxListeners(100);

export type AgentStreamEvent = ServerEvent | AssistantDeltaEvent | AssistantReasoningDeltaEvent;

export function publishWorkspaceSessionsChanged(): void {
  agentEventBus.emit(WORKSPACE_SESSIONS_CHANGED);
}

export function publishJobsChanged(): void {
  agentEventBus.emit(WORKSPACE_JOBS_CHANGED);
}

export function publishMemoryChanged(payload: MemoryChangedPayload): void {
  agentEventBus.emit(WORKSPACE_MEMORY_CHANGED, payload);
}

export function publishAgentEvent(event: AgentStreamEvent): void {
  if (event.topic !== "agent") {
    return;
  }

  agentEventBus.emit("event", event);
  if (
    event.kind === "event" &&
    (event.type === "turn.completed" ||
      event.type === "turn.failed" ||
      event.type === "turn.cancelled" ||
      event.type === "turn.interrupted")
  ) {
    publishWorkspaceSessionsChanged();
  }
}
