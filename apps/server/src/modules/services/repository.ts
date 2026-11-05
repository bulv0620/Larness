import type { ServiceDto } from "@larness/shared";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { type ServiceRow, services } from "../../db/schema.js";

export const ACTIVE_SERVICE_STATUSES = ["REGISTERING", "STARTING", "RUNNING"] as const;

export function isActiveServiceStatus(status: ServiceRow["status"]): boolean {
  return status === "REGISTERING" || status === "STARTING" || status === "RUNNING";
}

export function serviceRow(db: DbExecutor, id: string): ServiceRow | null {
  return db.select().from(services).where(eq(services.id, id)).get() ?? null;
}

export function serviceByOperation(db: DbExecutor, operationId: string): ServiceRow | null {
  return db.select().from(services).where(eq(services.operationId, operationId)).get() ?? null;
}

export function insertService(db: DbExecutor, row: ServiceRow) {
  db.insert(services).values(row).run();
}

export function updateService(db: DbExecutor, id: string, fields: Partial<ServiceRow>) {
  db.update(services).set(fields).where(eq(services.id, id)).run();
}

export function deleteServicesForTerminal(db: DbExecutor, terminalId: string) {
  db.delete(services).where(eq(services.terminalId, terminalId)).run();
}

export function activeServices(db: DbExecutor): ServiceRow[] {
  return db.select().from(services).where(inArray(services.status, ACTIVE_SERVICE_STATUSES)).all();
}

export function activeServiceAt(
  db: DbExecutor,
  terminalId: string,
  host: string,
  port: number,
): ServiceRow | null {
  return (
    db
      .select()
      .from(services)
      .where(
        and(
          eq(services.terminalId, terminalId),
          eq(services.endpointHost, host),
          eq(services.endpointPort, port),
          inArray(services.status, ACTIVE_SERVICE_STATUSES),
        ),
      )
      .get() ?? null
  );
}

export interface ServiceCursor {
  createdAt: number;
  id: string;
}

export function encodeServiceCursor(row: ServiceCursor): string {
  return Buffer.from(`${row.createdAt}:${row.id}`, "utf8").toString("base64url");
}

export function decodeServiceCursor(cursor: string): ServiceCursor | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split(":");
    const parsed = Number(createdAt);
    if (!Number.isInteger(parsed) || !id) return null;
    return { createdAt: parsed, id };
  } catch {
    return null;
  }
}

export function listServices(
  db: DbExecutor,
  input: {
    projectId: string;
    status?: ServiceRow["status"];
    limit: number;
    cursor?: ServiceCursor;
  },
): ServiceRow[] {
  const conditions = [eq(services.projectId, input.projectId)];
  if (input.status) conditions.push(eq(services.status, input.status));
  else conditions.push(inArray(services.status, ACTIVE_SERVICE_STATUSES));
  if (input.cursor) {
    const older = or(
      lt(services.createdAt, input.cursor.createdAt),
      and(eq(services.createdAt, input.cursor.createdAt), lt(services.id, input.cursor.id)),
    );
    if (older) conditions.push(older);
  }
  return db
    .select()
    .from(services)
    .where(and(...conditions))
    .orderBy(desc(services.createdAt), desc(services.id))
    .limit(input.limit)
    .all();
}

export function serviceDto(row: ServiceRow): ServiceDto {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceSessionId: row.sourceSessionId,
    name: row.name,
    kind: row.kind,
    status: row.status,
    terminalId: row.terminalId,
    terminalExecutionId: row.terminalExecutionId,
    endpointGeneration: row.endpointGeneration,
    endpoint: {
      host: row.endpointHost as ServiceDto["endpoint"]["host"],
      port: row.endpointPort,
      protocol: row.endpointProtocol,
    },
    previewEligible: row.status === "RUNNING",
    reasonCode: row.reasonCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    endedAt: row.endedAt,
  };
}
