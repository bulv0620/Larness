import type { ServiceOpsDeploymentDto, ServiceOpsServiceDto } from "@larness/shared";
import { desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type ServiceOpsDeploymentRow,
  type ServiceOpsServiceRow,
  serviceOpsDeployments,
  serviceOpsServices,
} from "../../db/schema.js";

export function serviceOpsRow(db: DbExecutor, targetId: string): ServiceOpsServiceRow | null {
  return (
    db.select().from(serviceOpsServices).where(eq(serviceOpsServices.targetId, targetId)).get() ??
    null
  );
}

export function listServiceOpsRows(db: DbExecutor): ServiceOpsServiceRow[] {
  return db
    .select()
    .from(serviceOpsServices)
    .orderBy(desc(serviceOpsServices.updatedAt), desc(serviceOpsServices.targetId))
    .all();
}

export function insertServiceOpsRow(db: DbExecutor, row: ServiceOpsServiceRow): void {
  db.insert(serviceOpsServices).values(row).run();
}

export function updateServiceOpsRow(
  db: DbExecutor,
  targetId: string,
  fields: Partial<Omit<ServiceOpsServiceRow, "targetId" | "createdAt">>,
): void {
  db.update(serviceOpsServices).set(fields).where(eq(serviceOpsServices.targetId, targetId)).run();
}

export function deploymentOpsById(db: DbExecutor, id: string): ServiceOpsDeploymentRow | null {
  return (
    db.select().from(serviceOpsDeployments).where(eq(serviceOpsDeployments.id, id)).get() ?? null
  );
}

export function deploymentOpsByPlan(
  db: DbExecutor,
  planId: string,
): ServiceOpsDeploymentRow | null {
  return (
    db.select().from(serviceOpsDeployments).where(eq(serviceOpsDeployments.planId, planId)).get() ??
    null
  );
}

export function deploymentOpsByAuthorization(
  db: DbExecutor,
  authorizationId: string,
): ServiceOpsDeploymentRow | null {
  return (
    db
      .select()
      .from(serviceOpsDeployments)
      .where(eq(serviceOpsDeployments.authorizationId, authorizationId))
      .get() ?? null
  );
}

export function insertDeploymentOps(db: DbExecutor, row: ServiceOpsDeploymentRow): void {
  db.insert(serviceOpsDeployments).values(row).run();
}

export function updateDeploymentOps(
  db: DbExecutor,
  id: string,
  fields: Partial<
    Pick<ServiceOpsDeploymentRow, "status" | "reasonCode" | "healthJson" | "resultJson" | "endedAt">
  >,
): void {
  db.update(serviceOpsDeployments).set(fields).where(eq(serviceOpsDeployments.id, id)).run();
}

export function listDeploymentOps(
  db: DbExecutor,
  targetId: string,
  limit = 50,
): ServiceOpsDeploymentRow[] {
  return db
    .select()
    .from(serviceOpsDeployments)
    .where(eq(serviceOpsDeployments.targetId, targetId))
    .orderBy(desc(serviceOpsDeployments.createdAt), desc(serviceOpsDeployments.id))
    .limit(limit)
    .all();
}

export function serviceOpsDto(row: ServiceOpsServiceRow): ServiceOpsServiceDto {
  return {
    targetId: row.targetId as ServiceOpsServiceDto["targetId"],
    projectId: row.projectId,
    name: row.name as ServiceOpsServiceDto["name"],
    version: row.currentVersion as ServiceOpsServiceDto["version"],
    artifactHash: null,
    desiredState: row.desiredState,
    observedState: row.observedState,
    pid: row.pid,
    lastHealthAt: row.lastHealthAt,
    reasonCode: row.reasonCode,
    updatedAt: row.updatedAt,
  };
}

export function deploymentOpsDto(row: ServiceOpsDeploymentRow): ServiceOpsDeploymentDto {
  return {
    id: row.id as ServiceOpsDeploymentDto["id"],
    targetId: row.targetId as ServiceOpsDeploymentDto["targetId"],
    planId: row.planId as ServiceOpsDeploymentDto["planId"],
    authorizationId: row.authorizationId as ServiceOpsDeploymentDto["authorizationId"],
    artifactId: row.artifactId as ServiceOpsDeploymentDto["artifactId"],
    previousArtifactId: row.previousArtifactId as ServiceOpsDeploymentDto["previousArtifactId"],
    previousVersion: row.previousVersion as ServiceOpsDeploymentDto["previousVersion"],
    version: row.version as ServiceOpsDeploymentDto["version"],
    status: row.status,
    planHash: row.planHash,
    artifactHash: row.artifactHash,
    reasonCode: row.reasonCode,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}
