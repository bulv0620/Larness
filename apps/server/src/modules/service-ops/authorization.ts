import {
  DEPLOYMENT_APPROVAL_TTL_MS,
  type DeploymentApprovalDto,
  type DeploymentApprovalStatus,
  type DeploymentAuthorizationContext,
  DeploymentAuthorizationContextSchema,
  type DeploymentAuthorizationDto,
  type DeploymentAuthorizationScope,
  type DeploymentAuthorizationStatus,
  type DeploymentPolicy,
  hasControlCharacters,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import type { DeploymentApprovalRow, DeploymentAuthorizationRow } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import {
  approvalByAuthorization,
  approvalById,
  approvalDto,
  approvalsInStatus,
  authorizationById,
  authorizationByRequestKey,
  authorizationDto,
  authorizationsForPlan,
  authorizationsInStatus,
  insertApproval,
  insertAuthorization,
  updateApproval,
  updateAuthorization,
} from "./authorizationRepository.js";
import { canonicalJson, sha256 } from "./canonical.js";
import type { DeploymentManager } from "./deployments.js";
import { DeploymentError } from "./errors.js";
import { updatePlanStatus as updateDeploymentPlanStatus } from "./repository.js";

export type DeploymentAccessDecision = "allow" | "require_approval" | "deny";
export type DeploymentRisk = "L0" | "L1" | "L2" | "L3";

export function decideDeploymentAccess(
  policy: DeploymentPolicy,
  risk: DeploymentRisk,
): DeploymentAccessDecision {
  if (policy === "readonly") return risk === "L0" ? "allow" : "deny";
  if (policy === "autonomous") return "allow";
  if (risk === "L3") return "deny";
  if (risk === "L0") return "allow";
  if (policy === "strict") return "require_approval";
  return risk === "L2" ? "require_approval" : "allow";
}

export interface DeploymentAuthorizationServiceOptions {
  db: Database;
  deployments: DeploymentManager;
  now?: () => number;
}

export interface AuthorizePlanInput {
  planId: string;
  requestKey: string;
  context: unknown;
}

export interface AuthorizationResult {
  authorization: DeploymentAuthorizationDto;
  approval: DeploymentApprovalDto | null;
}

export interface DecideDeploymentApprovalInput {
  approvalId: string;
  decision: "approve" | "reject";
  decidedBy: string;
}

export interface ConsumeAuthorizationInput {
  authorizationId: string;
  requestKey: string;
  context: unknown;
}

function text(value: unknown, field: string, max: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > max ||
    hasControlCharacters(value)
  ) {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", `Invalid ${field}`);
  }
  return value;
}

function parseContext(value: unknown): DeploymentAuthorizationContext {
  const parsed = DeploymentAuthorizationContextSchema.safeParse(value);
  if (!parsed.success) {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Invalid deployment authorization context");
  }
  if (parsed.data.action !== "apply") {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Unsupported deployment authorization action");
  }
  if (parsed.data.actor.type === "human" && parsed.data.clientSessionId === null) {
    throw new DeploymentError(
      "DEPLOY_AUTH_INVALID",
      "Human deployment actor requires a client session",
    );
  }
  if (
    parsed.data.actor.type === "agent" &&
    (parsed.data.sessionId === null || parsed.data.turnId === null)
  ) {
    throw new DeploymentError(
      "DEPLOY_AUTH_INVALID",
      "Agent deployment actor requires session and turn",
    );
  }
  return parsed.data;
}

function contextMatches(
  auth: DeploymentAuthorizationRow,
  context: DeploymentAuthorizationContext,
): boolean {
  if (
    context.projectId !== auth.projectId ||
    context.targetId !== auth.targetId ||
    context.action !== auth.action ||
    context.policy !== auth.policy ||
    context.policySnapshotId !== auth.policySnapshotId ||
    context.actor.type !== auth.actorType ||
    context.actor.id !== auth.actorId
  ) {
    return false;
  }
  if (auth.actorType === "human") return context.clientSessionId === auth.clientSessionId;
  return context.sessionId === auth.sessionId && context.turnId === auth.turnId;
}

function approvalExpiry(now: number, authorizationExpiresAt: number): number {
  return Math.min(now + DEPLOYMENT_APPROVAL_TTL_MS, authorizationExpiresAt);
}

export class DeploymentAuthorizationService {
  readonly #db: Database;
  readonly #deployments: DeploymentManager;
  readonly #now: () => number;

  constructor(options: DeploymentAuthorizationServiceOptions) {
    this.#db = options.db;
    this.#deployments = options.deployments;
    this.#now = options.now ?? Date.now;
  }

  async authorizePlan(input: AuthorizePlanInput): Promise<AuthorizationResult> {
    const planId = text(input.planId, "plan", 128);
    const requestKey = text(input.requestKey, "request key", 256);
    const context = parseContext(input.context);
    const now = this.#now();

    const plan = this.#deployments.getPlan(planId);
    if (plan.status !== "READY") {
      throw new DeploymentError(
        plan.status === "EXPIRED" ? "DEPLOY_PLAN_EXPIRED" : "DEPLOY_PLAN_INVALID",
        "Deployment plan is not ready",
      );
    }
    if (plan.projectId !== context.projectId || plan.targetId !== context.targetId) {
      throw new DeploymentError(
        "DEPLOY_AUTH_INVALID",
        "Deployment plan is outside the authorization scope",
      );
    }
    const verified = await this.#deployments.verifyPlan(planId);
    if (!verified.valid) this.#planFailure(verified.code);

    const existing = authorizationByRequestKey(this.#db, requestKey);
    if (existing) {
      if (existing.planId !== planId || !contextMatches(existing, context)) {
        throw new DeploymentError(
          "DEPLOY_CONFLICT",
          "Request key belongs to another authorization",
        );
      }
      return {
        authorization: authorizationDto(existing),
        approval: this.#approvalFor(existing),
      };
    }

    const decision = decideDeploymentAccess(context.policy, "L2");
    const status: DeploymentAuthorizationStatus =
      decision === "allow" ? "AUTHORIZED" : decision === "deny" ? "DENIED" : "PENDING";
    const scope: DeploymentAuthorizationScope = {
      domain: "service-ops",
      projectId: plan.projectId,
      targetId: plan.targetId,
      planId: plan.id,
      action: "apply",
      planHash: plan.planHash,
      artifactHash: plan.plan.artifactHash,
    };
    const scopeJson = canonicalJson(scope);
    const scopeHash = sha256(scopeJson);
    const authorizationId = newId("dauth");
    const approvalId = decision === "require_approval" ? newId("dapv") : null;
    const authorizationExpiresAt = plan.expiresAt;
    if (authorizationExpiresAt <= now) {
      throw new DeploymentError("DEPLOY_PLAN_EXPIRED", "Deployment plan has expired");
    }

    const authorizationRow: DeploymentAuthorizationRow = {
      id: authorizationId,
      planId: plan.id,
      targetId: plan.targetId,
      projectId: plan.projectId,
      action: "apply",
      actorType: context.actor.type,
      actorId: context.actor.id,
      clientSessionId: context.clientSessionId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      policy: context.policy,
      policySnapshotId: context.policySnapshotId,
      status,
      planHash: plan.planHash,
      artifactHash: plan.plan.artifactHash,
      scopeJson,
      scopeHash,
      approvalId,
      requestKey,
      expiresAt: authorizationExpiresAt,
      decidedAt: status === "PENDING" ? null : now,
      consumedAt: null,
      consumeKey: null,
      reasonCode: status === "DENIED" ? "POLICY_DENIED" : null,
      createdAt: now,
    };
    const approvalRow: DeploymentApprovalRow | null =
      approvalId === null
        ? null
        : {
            id: approvalId,
            authorizationId,
            planId: plan.id,
            targetId: plan.targetId,
            projectId: plan.projectId,
            status: "PENDING",
            planHash: plan.planHash,
            artifactHash: plan.plan.artifactHash,
            requestedBy: context.actor.id,
            decidedBy: null,
            expiresAt: approvalExpiry(now, authorizationExpiresAt),
            decidedAt: null,
            createdAt: now,
          };

    immediateTransaction(this.#db, (tx) => {
      insertAuthorization(tx, authorizationRow);
      if (approvalRow !== null) {
        insertApproval(tx, approvalRow);
        updateAuthorization(tx, authorizationId, { approvalId });
      }
      this.#audit(tx, {
        action: "deployment.authorization.requested",
        decision: "info",
        resourceId: authorizationId,
        context,
        details: {
          planId: plan.id,
          targetId: plan.targetId,
          policy: context.policy,
          policySnapshotId: context.policySnapshotId,
          planHash: plan.planHash,
          artifactHash: plan.plan.artifactHash,
          approvalId,
        },
        now,
      });
      if (status === "AUTHORIZED") {
        this.#audit(tx, {
          action: "deployment.authorization.granted",
          decision: "allow",
          resourceId: authorizationId,
          context,
          details: {
            planId: plan.id,
            targetId: plan.targetId,
            policy: context.policy,
            policySnapshotId: context.policySnapshotId,
            planHash: plan.planHash,
            artifactHash: plan.plan.artifactHash,
            approvalId: null,
          },
          now,
        });
      } else if (status === "DENIED") {
        this.#audit(tx, {
          action: "deployment.authorization.denied",
          decision: "deny",
          resourceId: authorizationId,
          context,
          details: {
            planId: plan.id,
            targetId: plan.targetId,
            policy: context.policy,
            reason: "POLICY_DENIED",
          },
          now,
        });
      } else if (approvalRow !== null) {
        this.#audit(tx, {
          action: "deployment.approval.requested",
          decision: "info",
          resourceId: approvalRow.id,
          context,
          details: {
            authorizationId,
            planId: plan.id,
            targetId: plan.targetId,
            policy: context.policy,
            planHash: plan.planHash,
            artifactHash: plan.plan.artifactHash,
            expiresAt: approvalRow.expiresAt,
          },
          now,
        });
      }
    });

    return {
      authorization: authorizationDto(authorizationRow),
      approval: approvalRow === null ? null : approvalDto(approvalRow),
    };
  }

  async decideApproval(input: DecideDeploymentApprovalInput): Promise<AuthorizationResult> {
    const approvalId = text(input.approvalId, "approval", 128);
    const decidedBy = text(input.decidedBy, "decided by", 128);
    const now = this.#now();
    const approval = approvalById(this.#db, approvalId);
    if (!approval) {
      throw new DeploymentError("DEPLOY_APPROVAL_INVALID", "Deployment approval was not found");
    }
    if (approval.status === "PENDING" && approval.expiresAt <= now) {
      this.#expireApproval(approval, now);
      throw new DeploymentError("DEPLOY_APPROVAL_EXPIRED", "Deployment approval has expired");
    }
    if (approval.status !== "PENDING") {
      throw new DeploymentError("DEPLOY_APPROVAL_INVALID", "Deployment approval is not pending");
    }
    const authorization = authorizationById(this.#db, approval.authorizationId);
    if (!authorization || authorization.status !== "PENDING") {
      throw new DeploymentError(
        "DEPLOY_APPROVAL_INVALID",
        "Deployment authorization is not pending",
      );
    }
    if (authorization.expiresAt <= now) {
      this.#expireAuthorization(authorization, now, "AUTHORIZATION_EXPIRED");
      throw new DeploymentError("DEPLOY_APPROVAL_EXPIRED", "Deployment authorization has expired");
    }
    const verified = await this.#deployments.verifyPlan(authorization.planId);
    if (!verified.valid) {
      this.#invalidateAuthorization(authorization, verified.code ?? "PLAN_INVALID", now);
      throw new DeploymentError(
        verified.code === "PLAN_EXPIRED"
          ? "DEPLOY_PLAN_EXPIRED"
          : verified.code === "ARTIFACT_MISSING" || verified.code === "ARTIFACT_HASH_MISMATCH"
            ? "DEPLOY_ARTIFACT_INVALID"
            : "DEPLOY_PLAN_INVALID",
        "Deployment plan is no longer valid",
      );
    }

    const nextApproval: DeploymentApprovalStatus =
      input.decision === "approve" ? "APPROVED" : "DENIED";
    const nextAuthorization: DeploymentAuthorizationStatus =
      input.decision === "approve" ? "AUTHORIZED" : "DENIED";
    immediateTransaction(this.#db, (tx) => {
      const currentApproval = approvalById(tx, approvalId);
      const currentAuthorization = authorizationById(tx, approval.authorizationId);
      if (
        !currentApproval ||
        currentApproval.status !== "PENDING" ||
        currentApproval.expiresAt <= now ||
        !currentAuthorization ||
        currentAuthorization.status !== "PENDING" ||
        currentAuthorization.expiresAt <= now
      ) {
        throw new DeploymentError("DEPLOY_APPROVAL_INVALID", "Deployment approval changed");
      }
      updateApproval(tx, approvalId, {
        status: nextApproval,
        decidedBy,
        decidedAt: now,
      });
      updateAuthorization(tx, currentAuthorization.id, {
        status: nextAuthorization,
        decidedAt: now,
        reasonCode: input.decision === "reject" ? "APPROVAL_DENIED" : null,
      });
      this.#audit(tx, {
        action:
          input.decision === "approve"
            ? "deployment.approval.granted"
            : "deployment.approval.denied",
        decision: input.decision === "approve" ? "allow" : "deny",
        resourceId: approvalId,
        context: this.#contextFromRow(currentAuthorization),
        details: {
          authorizationId: currentAuthorization.id,
          planId: currentAuthorization.planId,
          targetId: currentAuthorization.targetId,
          policy: currentAuthorization.policy,
          policySnapshotId: currentAuthorization.policySnapshotId,
          planHash: currentAuthorization.planHash,
          artifactHash: currentAuthorization.artifactHash,
          decidedBy,
        },
        now,
      });
      this.#audit(tx, {
        action:
          input.decision === "approve"
            ? "deployment.authorization.granted"
            : "deployment.authorization.denied",
        decision: input.decision === "approve" ? "allow" : "deny",
        resourceId: currentAuthorization.id,
        context: this.#contextFromRow(currentAuthorization),
        details: {
          planId: currentAuthorization.planId,
          targetId: currentAuthorization.targetId,
          policy: currentAuthorization.policy,
          policySnapshotId: currentAuthorization.policySnapshotId,
          planHash: currentAuthorization.planHash,
          artifactHash: currentAuthorization.artifactHash,
          approvalId,
        },
        now,
      });
    });

    return {
      authorization: authorizationDto(this.#requireAuthorization(authorization.id)),
      approval: approvalDto(this.#requireApproval(approvalId)),
    };
  }

  async verifyAuthorization(
    authorizationId: string,
    context?: unknown,
  ): Promise<DeploymentAuthorizationDto> {
    const id = text(authorizationId, "authorization", 128);
    const row = authorizationById(this.#db, id);
    if (!row)
      throw new DeploymentError("DEPLOY_AUTH_REQUIRED", "Deployment authorization not found");
    if (row.status === "PENDING") {
      throw new DeploymentError("DEPLOY_AUTH_REQUIRED", "Deployment authorization is pending");
    }
    if (row.status === "CONSUMED") {
      throw new DeploymentError(
        "DEPLOY_AUTH_INVALID",
        "Deployment authorization was already consumed",
      );
    }
    if (
      row.status === "DENIED" ||
      row.status === "REVOKED" ||
      row.status === "EXPIRED" ||
      row.status === "INVALIDATED"
    ) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization is not usable");
    }
    const now = this.#now();
    if (row.expiresAt <= now) {
      this.#expireAuthorization(row, now, "AUTHORIZATION_EXPIRED");
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization has expired");
    }
    if (context !== undefined) {
      const parsed = parseContext(context);
      if (!contextMatches(row, parsed)) {
        throw new DeploymentError(
          "DEPLOY_AUTH_INVALID",
          "Deployment authorization context does not match",
        );
      }
    }
    const verified = await this.#deployments.verifyPlan(row.planId);
    if (!verified.valid) {
      this.#invalidateAuthorization(row, verified.code ?? "PLAN_INVALID", now);
      throw new DeploymentError(
        verified.code === "PLAN_EXPIRED"
          ? "DEPLOY_PLAN_EXPIRED"
          : verified.code === "ARTIFACT_MISSING" || verified.code === "ARTIFACT_HASH_MISMATCH"
            ? "DEPLOY_ARTIFACT_INVALID"
            : "DEPLOY_AUTH_INVALID",
        "Deployment plan is no longer valid",
      );
    }
    const current = this.#requireAuthorization(id);
    if (
      current.planHash !== row.planHash ||
      current.artifactHash !== row.artifactHash ||
      current.scopeHash !== row.scopeHash
    ) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization binding changed");
    }
    return authorizationDto(current);
  }

  async consumeAuthorization(
    input: ConsumeAuthorizationInput,
  ): Promise<DeploymentAuthorizationDto> {
    const authorizationId = text(input.authorizationId, "authorization", 128);
    const requestKey = text(input.requestKey, "consume key", 256);
    const context = parseContext(input.context);
    const row = authorizationById(this.#db, authorizationId);
    if (!row)
      throw new DeploymentError("DEPLOY_AUTH_REQUIRED", "Deployment authorization not found");
    if (row.status === "CONSUMED") {
      if (row.consumeKey === requestKey) return authorizationDto(row);
      throw new DeploymentError(
        "DEPLOY_AUTH_INVALID",
        "Deployment authorization was already consumed",
      );
    }
    if (!contextMatches(row, context)) {
      throw new DeploymentError(
        "DEPLOY_AUTH_INVALID",
        "Deployment authorization context does not match",
      );
    }
    await this.verifyAuthorization(authorizationId, context);
    const now = this.#now();
    immediateTransaction(this.#db, (tx) => {
      const current = authorizationById(tx, authorizationId);
      if (!current || current.status !== "AUTHORIZED" || current.expiresAt <= now) {
        throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization is not usable");
      }
      updateAuthorization(tx, authorizationId, {
        status: "CONSUMED",
        consumedAt: now,
        consumeKey: requestKey,
      });
      this.#audit(tx, {
        action: "deployment.authorization.consumed",
        decision: "allow",
        resourceId: authorizationId,
        context,
        details: {
          planId: current.planId,
          targetId: current.targetId,
          policy: current.policy,
          policySnapshotId: current.policySnapshotId,
          planHash: current.planHash,
          artifactHash: current.artifactHash,
          consumeKey: requestKey,
        },
        now,
      });
    });
    return authorizationDto(this.#requireAuthorization(authorizationId));
  }

  revokeAuthorization(input: {
    authorizationId: string;
    actor: string;
    reason: string;
  }): DeploymentAuthorizationDto {
    const authorizationId = text(input.authorizationId, "authorization", 128);
    const actor = text(input.actor, "actor", 128);
    const reason = text(input.reason, "reason", 64);
    const row = authorizationById(this.#db, authorizationId);
    if (!row)
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization not found");
    if (row.status === "CONSUMED" || row.status === "DENIED" || row.status === "EXPIRED") {
      throw new DeploymentError(
        "DEPLOY_AUTH_INVALID",
        "Deployment authorization cannot be revoked",
      );
    }
    if (row.status === "REVOKED") return authorizationDto(row);
    const now = this.#now();
    immediateTransaction(this.#db, (tx) => {
      updateAuthorization(tx, authorizationId, {
        status: "REVOKED",
        reasonCode: reason,
        decidedAt: now,
      });
      const approval = approvalByAuthorization(tx, authorizationId);
      if (approval?.status === "PENDING") {
        updateApproval(tx, approval.id, { status: "REVOKED", decidedBy: actor, decidedAt: now });
      }
      this.#audit(tx, {
        action: "deployment.authorization.revoked",
        decision: "deny",
        resourceId: authorizationId,
        context: this.#contextFromRow(row),
        details: {
          planId: row.planId,
          targetId: row.targetId,
          policy: row.policy,
          policySnapshotId: row.policySnapshotId,
          actor,
          reason,
        },
        now,
      });
    });
    return authorizationDto(this.#requireAuthorization(authorizationId));
  }

  revokePlan(input: { planId: string; actor: string; reason: string }): { invalidated: number } {
    const planId = text(input.planId, "plan", 128);
    const actor = text(input.actor, "actor", 128);
    const reason = text(input.reason, "reason", 64);
    const plan = this.#deployments.getPlan(planId);
    if (plan.status !== "READY") {
      throw new DeploymentError(
        plan.status === "EXPIRED" ? "DEPLOY_PLAN_EXPIRED" : "DEPLOY_PLAN_INVALID",
        "Deployment plan is not ready",
      );
    }
    const now = this.#now();
    let invalidated = 0;
    immediateTransaction(this.#db, (tx) => {
      updateDeploymentPlanStatus(tx, planId, "CANCELLED");
      for (const auth of authorizationsForPlan(tx, planId)) {
        if (auth.status !== "PENDING" && auth.status !== "AUTHORIZED") continue;
        updateAuthorization(tx, auth.id, {
          status: "INVALIDATED",
          reasonCode: "PLAN_REVOKED",
          decidedAt: now,
        });
        const approval = approvalByAuthorization(tx, auth.id);
        if (approval?.status === "PENDING") {
          updateApproval(tx, approval.id, { status: "REVOKED", decidedBy: actor, decidedAt: now });
        }
        invalidated += 1;
      }
      this.#audit(tx, {
        action: "deployment.plan.revoked",
        decision: "deny",
        resourceId: planId,
        details: { planId, targetId: plan.targetId, actor, reason, invalidated },
        now,
      });
    });
    return { invalidated };
  }

  getAuthorization(id: string): DeploymentAuthorizationDto {
    const authorizationId = text(id, "authorization", 128);
    const row = this.#requireAuthorization(authorizationId);
    return authorizationDto(this.#expireIfNeeded(row));
  }

  getApproval(id: string): DeploymentApprovalDto {
    const approvalId = text(id, "approval", 128);
    const row = this.#requireApproval(approvalId);
    if (row.status === "PENDING" && row.expiresAt <= this.#now()) {
      this.#expireApproval(row, this.#now());
      return approvalDto(this.#requireApproval(approvalId));
    }
    return approvalDto(row);
  }

  recoverExpired(): number {
    const now = this.#now();
    let count = 0;
    for (const row of authorizationsInStatus(this.#db, ["PENDING", "AUTHORIZED"])) {
      if (row.expiresAt <= now) {
        this.#expireAuthorization(row, now, "AUTHORIZATION_EXPIRED");
        count += 1;
      }
    }
    for (const row of approvalsInStatus(this.#db, ["PENDING"])) {
      if (row.expiresAt <= now) {
        this.#expireApproval(row, now);
        count += 1;
      }
    }
    return count;
  }

  #expireIfNeeded(row: DeploymentAuthorizationRow): DeploymentAuthorizationRow {
    const now = this.#now();
    if ((row.status === "PENDING" || row.status === "AUTHORIZED") && row.expiresAt <= now) {
      this.#expireAuthorization(row, now, "AUTHORIZATION_EXPIRED");
      return this.#requireAuthorization(row.id);
    }
    return row;
  }

  #expireAuthorization(row: DeploymentAuthorizationRow, now: number, reasonCode: string): void {
    immediateTransaction(this.#db, (tx) => {
      const current = authorizationById(tx, row.id);
      if (!current || (current.status !== "PENDING" && current.status !== "AUTHORIZED")) return;
      updateAuthorization(tx, row.id, { status: "EXPIRED", reasonCode, decidedAt: now });
      const approval = approvalByAuthorization(tx, row.id);
      if (approval?.status === "PENDING") {
        updateApproval(tx, approval.id, { status: "EXPIRED", decidedAt: now });
      }
      this.#audit(tx, {
        action: "deployment.authorization.expired",
        decision: "deny",
        resourceId: row.id,
        context: this.#contextFromRow(current),
        details: {
          planId: current.planId,
          targetId: current.targetId,
          policy: current.policy,
          reasonCode,
        },
        now,
      });
    });
  }

  #expireApproval(row: DeploymentApprovalRow, now: number): void {
    immediateTransaction(this.#db, (tx) => {
      const current = approvalById(tx, row.id);
      if (!current || current.status !== "PENDING") return;
      updateApproval(tx, row.id, { status: "EXPIRED", decidedAt: now });
      const authorization = authorizationById(tx, current.authorizationId);
      if (authorization?.status === "PENDING") {
        updateAuthorization(tx, authorization.id, {
          status: "EXPIRED",
          reasonCode: "APPROVAL_EXPIRED",
          decidedAt: now,
        });
      }
      this.#audit(tx, {
        action: "deployment.approval.expired",
        decision: "deny",
        resourceId: row.id,
        context: authorization ? this.#contextFromRow(authorization) : undefined,
        details: {
          authorizationId: current.authorizationId,
          planId: current.planId,
          targetId: current.targetId,
          reasonCode: "APPROVAL_EXPIRED",
        },
        now,
      });
    });
  }

  #invalidateAuthorization(row: DeploymentAuthorizationRow, reasonCode: string, now: number): void {
    immediateTransaction(this.#db, (tx) => {
      const current = authorizationById(tx, row.id);
      if (!current || (current.status !== "PENDING" && current.status !== "AUTHORIZED")) return;
      updateAuthorization(tx, row.id, { status: "INVALIDATED", reasonCode, decidedAt: now });
      const approval = approvalByAuthorization(tx, row.id);
      if (approval?.status === "PENDING") {
        updateApproval(tx, approval.id, { status: "EXPIRED", decidedAt: now });
      }
      this.#audit(tx, {
        action: "deployment.authorization.invalidated",
        decision: "deny",
        resourceId: row.id,
        context: this.#contextFromRow(current),
        details: {
          planId: current.planId,
          targetId: current.targetId,
          policy: current.policy,
          reasonCode,
        },
        now,
      });
    });
  }

  #planFailure(code: string | undefined): never {
    if (code === "PLAN_EXPIRED") {
      throw new DeploymentError("DEPLOY_PLAN_EXPIRED", "Deployment plan has expired");
    }
    if (code === "ARTIFACT_MISSING" || code === "ARTIFACT_HASH_MISMATCH") {
      throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Deployment artifact is not valid");
    }
    throw new DeploymentError("DEPLOY_PLAN_INVALID", "Deployment plan is not valid");
  }

  #requireAuthorization(id: string): DeploymentAuthorizationRow {
    const row = authorizationById(this.#db, id);
    if (!row)
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Deployment authorization not found");
    return row;
  }

  #requireApproval(id: string): DeploymentApprovalRow {
    const row = approvalById(this.#db, id);
    if (!row) throw new DeploymentError("DEPLOY_APPROVAL_INVALID", "Deployment approval not found");
    return row;
  }

  #approvalFor(authorization: DeploymentAuthorizationRow): DeploymentApprovalDto | null {
    const row = authorization.approvalId
      ? approvalById(this.#db, authorization.approvalId)
      : approvalByAuthorization(this.#db, authorization.id);
    return row ? approvalDto(row) : null;
  }

  #contextFromRow(row: DeploymentAuthorizationRow): DeploymentAuthorizationContext {
    return {
      domain: "service-ops",
      projectId: row.projectId,
      targetId: row.targetId as DeploymentAuthorizationContext["targetId"],
      action: row.action,
      policy: row.policy,
      policySnapshotId: row.policySnapshotId,
      actor: { type: row.actorType, id: row.actorId },
      clientSessionId: row.clientSessionId,
      sessionId: row.sessionId,
      turnId: row.turnId,
    };
  }

  #audit(
    db: import("../../db/client.js").DbExecutor,
    input: {
      action: string;
      decision: "allow" | "deny" | "info";
      resourceId: string;
      context?: DeploymentAuthorizationContext | undefined;
      details: Record<string, unknown>;
      now: number;
    },
  ): void {
    appendAudit(db, {
      action: input.action,
      decision: input.decision,
      ...(input.context?.clientSessionId === null || input.context?.clientSessionId === undefined
        ? {}
        : { clientSessionId: input.context.clientSessionId }),
      ...(input.context?.sessionId === null || input.context?.sessionId === undefined
        ? {}
        : { sessionId: input.context.sessionId }),
      resourceType: input.action.startsWith("deployment.approval")
        ? "deployment_approval"
        : input.action.startsWith("deployment.plan")
          ? "deployment_plan"
          : "deployment_authorization",
      resourceId: input.resourceId,
      details: input.details,
      now: input.now,
    });
  }
}
