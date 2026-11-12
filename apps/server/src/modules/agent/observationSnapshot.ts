import path from "node:path";
import type { Pm2CommandContext } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SessionRow } from "../../db/schema.js";
import { operationRow } from "../commands/repository.js";
import { listServices, serviceDto } from "../services/repository.js";
import { allTerminals } from "../terminals/repository.js";

export interface PreviewObservation {
  kind: string;
  projectId: string;
  serviceId: string;
  name: string;
  terminalId: string | null;
  terminalExecutionId: string | null;
  endpointGeneration: number;
  endpoint: { host: string; port: number; protocol: string };
  status: string;
  updatedAt: number;
}

export interface TerminalObservation {
  terminalId: string;
  title: string | null;
  mode: string;
}

export interface GitObservation {
  detected: boolean;
  observedAt: number;
}

export interface ObservationSnapshot {
  /** When this snapshot was taken. Callers must treat older snapshots as stale. */
  observedAt: number;
  preview: PreviewObservation[];
  terminals: TerminalObservation[];
  pm2: Pm2CommandContext | null;
  git: GitObservation | null;
}

const MAX_PREVIEW_SERVICES = 50;
const MAX_TERMINALS = 50;

/**
 * One builder shared by the Turn-start system snapshot and the
 * `refresh_observations` tool, so both describe the same facts the same way.
 */
export function buildObservationSnapshot(options: {
  db: Database;
  session: SessionRow;
  workspaceRoot?: string;
  pm2?: Pm2CommandContext | null;
  git?: GitObservation | null;
  now?: number;
}): ObservationSnapshot {
  const { db, session } = options;
  const preview = session.projectId
    ? listServices(db, { projectId: session.projectId, limit: MAX_PREVIEW_SERVICES })
        .map(serviceDto)
        .map((service) => ({
          kind: service.kind,
          projectId: service.projectId,
          serviceId: service.id,
          name: service.name,
          terminalId: service.terminalId,
          terminalExecutionId: service.terminalExecutionId,
          endpointGeneration: service.endpointGeneration,
          endpoint: service.endpoint,
          status: service.status,
          updatedAt: service.updatedAt,
        }))
    : [];

  const workspaceRoot = options.workspaceRoot ?? session.workspacePath;
  const terminals = allTerminals(db)
    .filter(
      (item) =>
        item.status === "RUNNING" &&
        (session.projectId
          ? item.projectId === session.projectId
          : item.projectId === null &&
            (item.workspaceSessionId === session.id ||
              path.resolve(operationRow(db, item.operationId)?.rootRealPath ?? "") ===
                path.resolve(workspaceRoot))),
    )
    .slice(-MAX_TERMINALS)
    .map((item) => ({
      terminalId: item.id,
      title: item.title ?? item.role,
      mode: item.mode,
    }));

  return {
    observedAt: options.now ?? Date.now(),
    preview,
    terminals,
    pm2: options.pm2 ?? null,
    git: options.git ?? null,
  };
}
