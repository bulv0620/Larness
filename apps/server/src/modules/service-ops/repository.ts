import {
  type DeploymentArtifactDto,
  type DeploymentBuildDto,
  DeploymentPlanDocumentSchema,
  type DeploymentPlanDto,
  type DeploymentSource,
  DeploymentSourceSchema,
  type DeploymentSpec,
  DeploymentSpecSchema,
  type DeploymentTargetDto,
  type DeploymentTargetName,
  type DeploymentVersion,
} from "@larness/shared";
import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type DeploymentArtifactRow,
  type DeploymentBuildRow,
  type DeploymentPlanRow,
  type DeploymentTargetRow,
  deploymentArtifacts,
  deploymentBuilds,
  deploymentPlans,
  deploymentTargets,
} from "../../db/schema.js";
import { DeploymentError } from "./errors.js";

export function targetById(db: DbExecutor, id: string): DeploymentTargetRow | null {
  return db.select().from(deploymentTargets).where(eq(deploymentTargets.id, id)).get() ?? null;
}

export function targetByName(
  db: DbExecutor,
  projectId: string,
  name: string,
): DeploymentTargetRow | null {
  return (
    db
      .select()
      .from(deploymentTargets)
      .where(and(eq(deploymentTargets.projectId, projectId), eq(deploymentTargets.name, name)))
      .get() ?? null
  );
}

export function insertTarget(db: DbExecutor, row: DeploymentTargetRow): void {
  db.insert(deploymentTargets).values(row).run();
}

export function buildById(db: DbExecutor, id: string): DeploymentBuildRow | null {
  return db.select().from(deploymentBuilds).where(eq(deploymentBuilds.id, id)).get() ?? null;
}

export function buildByRequestKey(db: DbExecutor, key: string): DeploymentBuildRow | null {
  return (
    db.select().from(deploymentBuilds).where(eq(deploymentBuilds.requestKey, key)).get() ?? null
  );
}

export function insertBuild(db: DbExecutor, row: DeploymentBuildRow): void {
  db.insert(deploymentBuilds).values(row).run();
}

export function updateBuild(
  db: DbExecutor,
  id: string,
  fields: Partial<Pick<DeploymentBuildRow, "status" | "reasonCode" | "endedAt">>,
): void {
  db.update(deploymentBuilds).set(fields).where(eq(deploymentBuilds.id, id)).run();
}

export function runningBuilds(db: DbExecutor): DeploymentBuildRow[] {
  return db.select().from(deploymentBuilds).where(eq(deploymentBuilds.status, "RUNNING")).all();
}

export function artifactById(db: DbExecutor, id: string): DeploymentArtifactRow | null {
  return db.select().from(deploymentArtifacts).where(eq(deploymentArtifacts.id, id)).get() ?? null;
}

export function artifactByBuildId(db: DbExecutor, buildId: string): DeploymentArtifactRow | null {
  return (
    db.select().from(deploymentArtifacts).where(eq(deploymentArtifacts.buildId, buildId)).get() ??
    null
  );
}

export function insertArtifact(db: DbExecutor, row: DeploymentArtifactRow): void {
  db.insert(deploymentArtifacts).values(row).run();
}

export function planById(db: DbExecutor, id: string): DeploymentPlanRow | null {
  return db.select().from(deploymentPlans).where(eq(deploymentPlans.id, id)).get() ?? null;
}

export function planByRequestKey(db: DbExecutor, key: string): DeploymentPlanRow | null {
  return db.select().from(deploymentPlans).where(eq(deploymentPlans.requestKey, key)).get() ?? null;
}

export function insertPlan(db: DbExecutor, row: DeploymentPlanRow): void {
  db.insert(deploymentPlans).values(row).run();
}

export function updatePlanStatus(
  db: DbExecutor,
  id: string,
  status: DeploymentPlanRow["status"],
): void {
  db.update(deploymentPlans).set({ status }).where(eq(deploymentPlans.id, id)).run();
}

export function targetDto(row: DeploymentTargetRow): DeploymentTargetDto {
  return {
    id: row.id as DeploymentTargetDto["id"],
    projectId: row.projectId,
    name: row.name as DeploymentTargetName,
    currentArtifactId: row.currentArtifactId as DeploymentTargetDto["currentArtifactId"],
    currentVersion: row.currentVersion as DeploymentVersion | null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function storedSpec(row: { specJson: string }): DeploymentSpec {
  try {
    return DeploymentSpecSchema.parse(JSON.parse(row.specJson));
  } catch {
    throw new DeploymentError("DEPLOY_UNAVAILABLE", "Stored deployment specification is invalid");
  }
}

export function buildDto(row: DeploymentBuildRow): DeploymentBuildDto {
  return {
    id: row.id as DeploymentBuildDto["id"],
    targetId: row.targetId as DeploymentBuildDto["targetId"],
    projectId: row.projectId,
    status: row.status,
    spec: storedSpec(row),
    specHash: row.specHash,
    reasonCode: row.reasonCode,
    logRef: row.logRef,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    createdAt: row.createdAt,
  };
}

export function storedSource(row: DeploymentArtifactRow): DeploymentSource {
  try {
    return DeploymentSourceSchema.parse(JSON.parse(row.sourceJson));
  } catch {
    throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Stored artifact source is invalid");
  }
}

export function artifactDto(row: DeploymentArtifactRow): DeploymentArtifactDto {
  return {
    id: row.id as DeploymentArtifactDto["id"],
    buildId: row.buildId as DeploymentArtifactDto["buildId"],
    targetId: row.targetId as DeploymentArtifactDto["targetId"],
    projectId: row.projectId,
    version: row.version as DeploymentArtifactDto["version"],
    artifactHash: row.artifactHash,
    sizeBytes: row.sizeBytes,
    fileCount: row.fileCount,
    source: storedSource(row),
    createdAt: row.createdAt,
  };
}

export function planDto(row: DeploymentPlanRow): DeploymentPlanDto {
  let plan: DeploymentPlanDto["plan"];
  try {
    plan = DeploymentPlanDocumentSchema.parse(JSON.parse(row.planJson));
  } catch {
    throw new DeploymentError("DEPLOY_PLAN_INVALID", "Stored deployment plan is invalid");
  }
  return {
    id: row.id as DeploymentPlanDto["id"],
    targetId: row.targetId as DeploymentPlanDto["targetId"],
    projectId: row.projectId,
    artifactId: row.artifactId as DeploymentPlanDto["artifactId"],
    previousArtifactId: row.previousArtifactId as DeploymentPlanDto["previousArtifactId"],
    previousVersion: row.previousVersion as DeploymentVersion | null,
    version: row.version as DeploymentVersion,
    status: row.status,
    plan,
    planHash: row.planHash,
    expiresAt: row.expiresAt,
    requestedBy: row.requestedBy,
    createdAt: row.createdAt,
  };
}

export function latestPlanForTarget(db: DbExecutor, targetId: string): DeploymentPlanRow | null {
  return (
    db
      .select()
      .from(deploymentPlans)
      .where(eq(deploymentPlans.targetId, targetId))
      .orderBy(desc(deploymentPlans.createdAt), desc(deploymentPlans.id))
      .get() ?? null
  );
}

export function deletePlansForProject(db: DbExecutor, projectId: string): void {
  db.delete(deploymentPlans).where(eq(deploymentPlans.projectId, projectId)).run();
}

export function deleteDeploymentsForProject(db: DbExecutor, projectId: string): void {
  deletePlansForProject(db, projectId);
  db.delete(deploymentArtifacts).where(eq(deploymentArtifacts.projectId, projectId)).run();
  db.delete(deploymentBuilds).where(eq(deploymentBuilds.projectId, projectId)).run();
  db.delete(deploymentTargets).where(eq(deploymentTargets.projectId, projectId)).run();
}
