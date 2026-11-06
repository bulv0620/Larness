import {
  type DeploymentApprovalDto,
  type DeploymentApprovalStatus,
  type DeploymentAuthorizationDto,
  DeploymentAuthorizationScopeSchema,
  type DeploymentAuthorizationStatus,
} from "@larness/shared";
import { desc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import {
  type DeploymentApprovalRow,
  type DeploymentAuthorizationRow,
  deploymentApprovals,
  deploymentAuthorizations,
} from "../../db/schema.js";
import { DeploymentError } from "./errors.js";

export function authorizationById(db: DbExecutor, id: string): DeploymentAuthorizationRow | null {
  return (
    db.select().from(deploymentAuthorizations).where(eq(deploymentAuthorizations.id, id)).get() ??
    null
  );
}

export function authorizationByRequestKey(
  db: DbExecutor,
  key: string,
): DeploymentAuthorizationRow | null {
  return (
    db
      .select()
      .from(deploymentAuthorizations)
      .where(eq(deploymentAuthorizations.requestKey, key))
      .get() ?? null
  );
}

export function authorizationByApprovalId(
  db: DbExecutor,
  approvalId: string,
): DeploymentAuthorizationRow | null {
  return (
    db
      .select()
      .from(deploymentAuthorizations)
      .where(eq(deploymentAuthorizations.approvalId, approvalId))
      .get() ?? null
  );
}

export function insertAuthorization(db: DbExecutor, row: DeploymentAuthorizationRow): void {
  db.insert(deploymentAuthorizations).values(row).run();
}

export function updateAuthorization(
  db: DbExecutor,
  id: string,
  fields: Partial<
    Pick<
      DeploymentAuthorizationRow,
      "status" | "approvalId" | "decidedAt" | "consumedAt" | "consumeKey" | "reasonCode"
    >
  >,
): void {
  db.update(deploymentAuthorizations).set(fields).where(eq(deploymentAuthorizations.id, id)).run();
}

export function authorizationsForPlan(
  db: DbExecutor,
  planId: string,
): DeploymentAuthorizationRow[] {
  return db
    .select()
    .from(deploymentAuthorizations)
    .where(eq(deploymentAuthorizations.planId, planId))
    .all();
}

export function authorizationsInStatus(
  db: DbExecutor,
  statuses: DeploymentAuthorizationStatus[],
): DeploymentAuthorizationRow[] {
  return db
    .select()
    .from(deploymentAuthorizations)
    .where(inArray(deploymentAuthorizations.status, statuses))
    .all();
}

export function approvalById(db: DbExecutor, id: string): DeploymentApprovalRow | null {
  return db.select().from(deploymentApprovals).where(eq(deploymentApprovals.id, id)).get() ?? null;
}

export function approvalByAuthorization(
  db: DbExecutor,
  authorizationId: string,
): DeploymentApprovalRow | null {
  return (
    db
      .select()
      .from(deploymentApprovals)
      .where(eq(deploymentApprovals.authorizationId, authorizationId))
      .get() ?? null
  );
}

export function insertApproval(db: DbExecutor, row: DeploymentApprovalRow): void {
  db.insert(deploymentApprovals).values(row).run();
}

export function updateApproval(
  db: DbExecutor,
  id: string,
  fields: Partial<Pick<DeploymentApprovalRow, "status" | "decidedBy" | "decidedAt">>,
): void {
  db.update(deploymentApprovals).set(fields).where(eq(deploymentApprovals.id, id)).run();
}

export function approvalsInStatus(
  db: DbExecutor,
  statuses: DeploymentApprovalStatus[],
): DeploymentApprovalRow[] {
  return db
    .select()
    .from(deploymentApprovals)
    .where(inArray(deploymentApprovals.status, statuses))
    .all();
}

export function latestApprovalForPlan(
  db: DbExecutor,
  planId: string,
): DeploymentApprovalRow | null {
  return (
    db
      .select()
      .from(deploymentApprovals)
      .where(eq(deploymentApprovals.planId, planId))
      .orderBy(desc(deploymentApprovals.createdAt), desc(deploymentApprovals.id))
      .get() ?? null
  );
}

export function authorizationDto(row: DeploymentAuthorizationRow): DeploymentAuthorizationDto {
  let scope: DeploymentAuthorizationDto["scope"];
  try {
    scope = DeploymentAuthorizationScopeSchema.parse(JSON.parse(row.scopeJson));
  } catch {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Stored authorization scope is invalid");
  }
  return {
    id: row.id as DeploymentAuthorizationDto["id"],
    planId: row.planId as DeploymentAuthorizationDto["planId"],
    targetId: row.targetId as DeploymentAuthorizationDto["targetId"],
    projectId: row.projectId,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    clientSessionId: row.clientSessionId,
    sessionId: row.sessionId,
    turnId: row.turnId,
    policy: row.policy,
    policySnapshotId: row.policySnapshotId,
    status: row.status,
    planHash: row.planHash,
    artifactHash: row.artifactHash,
    scope,
    scopeHash: row.scopeHash,
    approvalId: row.approvalId as DeploymentAuthorizationDto["approvalId"],
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    consumedAt: row.consumedAt,
    reasonCode: row.reasonCode,
    createdAt: row.createdAt,
  };
}

export function approvalDto(row: DeploymentApprovalRow): DeploymentApprovalDto {
  return {
    id: row.id as DeploymentApprovalDto["id"],
    authorizationId: row.authorizationId as DeploymentApprovalDto["authorizationId"],
    planId: row.planId as DeploymentApprovalDto["planId"],
    targetId: row.targetId as DeploymentApprovalDto["targetId"],
    projectId: row.projectId,
    status: row.status,
    planHash: row.planHash,
    artifactHash: row.artifactHash,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
  };
}
