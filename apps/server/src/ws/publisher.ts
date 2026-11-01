import { EventEmitter } from "node:events";
import type { AssistantDeltaEvent, ServerEvent } from "@larness/shared";

class AgentEventBus extends EventEmitter {}

export const agentEventBus = new AgentEventBus();
agentEventBus.setMaxListeners(100);

export type AgentStreamEvent = ServerEvent | AssistantDeltaEvent;

export function publishAgentEvent(event: AgentStreamEvent): void {
  if (event.topic !== "agent") {
    return;
  }

  agentEventBus.emit("event", event);
}
