import type { Pm2CommandContext } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SessionRow } from "../../db/schema.js";
import { listServices, serviceDto } from "../services/repository.js";

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

export interface GitObservation {
  detected: boolean;
  observedAt: number;
}

export interface ObservationSnapshot {
  /** When this snapshot was taken. Callers must treat older snapshots as stale. */
  observedAt: number;
  preview: PreviewObservation[];
  pm2: Pm2CommandContext | null;
  git: GitObservation | null;
}

const MAX_PREVIEW_SERVICES = 50;

/**
 * One builder shared by the Turn-start system snapshot and the
 * `refresh_observations` tool, so both describe the same facts the same way.
 */
export function buildObservationSnapshot(options: {
  db: Database;
  session: SessionRow;
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

  return {
    observedAt: options.now ?? Date.now(),
    preview,
    pm2: options.pm2 ?? null,
    git: options.git ?? null,
  };
}
