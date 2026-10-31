import type {
  GitFileChange,
  HostMetrics,
  ModelProfile,
  Project,
  ServiceInfo,
  SessionSummary,
  TerminalInfo,
} from "./domain";
import type { TimelineItem, TurnEvent } from "./events";

export interface GatewaySnapshot {
  projects: Project[];
  sessions: SessionSummary[];
  models: ModelProfile[];
  host: HostMetrics;
  services: ServiceInfo[];
  terminals: TerminalInfo[];
  gitChanges: GitFileChange[];
}

export interface SendTurnInput {
  sessionId: string;
  text: string;
  signal: AbortSignal;
}

export interface Gateway {
  snapshot(): Promise<GatewaySnapshot>;
  timeline(sessionId: string): Promise<TimelineItem[]>;
  sendTurn(input: SendTurnInput): AsyncIterable<TurnEvent>;
  resolveApproval(approvalId: string, decision: "approve" | "reject"): Promise<void>;
  cancelTurn(sessionId: string): Promise<void>;
}
