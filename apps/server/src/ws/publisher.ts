import { EventEmitter } from "node:events";
import type { ServerEvent } from "@larness/shared";

class AgentEventBus extends EventEmitter {}

export const agentEventBus = new AgentEventBus();
agentEventBus.setMaxListeners(100);

export function publishAgentEvent(event: ServerEvent): void {
  if (event.topic !== "agent") {
    return;
  }

  agentEventBus.emit("event", event);
}
