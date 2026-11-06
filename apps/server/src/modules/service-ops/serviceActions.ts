import {
  DEPLOYMENT_APPROVAL_TTL_MS,
  type DeploymentAuthorizationContext,
  DeploymentAuthorizationContextSchema,
  hasControlCharacters,
  type ServiceAction,
  type ServiceActionAuthorizationDto,
  ServiceActionAuthorizationDtoSchema,
  ServiceActionScopeSchema,
} from "@larness/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import {
  deploymentArtifacts,
  type ServiceActionAuthorizationRow,
  serviceActionAuthorizations,
} from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { decideDeploymentAccess } from "./authorization.js";
import { canonicalJson, sha256 } from "./canonical.js";
import { DeploymentError } from "./errors.js";
import { serviceOpsRow } from "./serviceOpsRepository.js";

export interface ServiceActionAuthorizationServiceOptions {
  db: Database;
  now?: () => number;
}

export interface AuthorizeServiceActionInput {
  targetId: string;
  action: ServiceAction;
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
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Invalid service action context");
  }
  if (parsed.data.actor.type === "human" && parsed.data.clientSessionId === null) {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Human actor requires a client session");
  }
  if (
    parsed.data.actor.type === "agent" &&
    (parsed.data.sessionId === null || parsed.data.turnId === null)
  ) {
    throw new DeploymentError("DEPLOY_AUTH_INVALID", "Agent actor requires session and turn");
  }
  return parsed.data;
}

function contextMatches(
  row: ServiceActionAuthorizationRow,
  context: DeploymentAuthorizationContext,
): boolean {
  if (
    context.projectId !== row.projectId ||
    context.targetId !== row.targetId ||
    context.action !== row.action ||
    context.policy !== row.policy ||
    context.policySnapshotId !== row.policySnapshotId ||
    context.actor.type !== row.actorType ||
    context.actor.id !== row.actorId
  ) {
    return false;
  }
  return row.actorType === "human"
    ? context.clientSessionId === row.clientSessionId
    : context.sessionId === row.sessionId && context.turnId === row.turnId;
}

function dto(row: ServiceActionAuthorizationRow): ServiceActionAuthorizationDto {
  return ServiceActionAuthorizationDtoSchema.parse({
    id: row.id,
    targetId: row.targetId,
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
    artifactHash: row.artifactHash,
    version: row.version,
    scopeHash: row.scopeHash,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
    consumedAt: row.consumedAt,
    reasonCode: row.reasonCode,
    createdAt: row.createdAt,
  });
}

export class ServiceActionAuthorizationService {
  readonly #db: Database;
  readonly #now: () => number;

  constructor(options: ServiceActionAuthorizationServiceOptions) {
    this.#db = options.db;
    this.#now = options.now ?? Date.now;
  }

  authorize(input: AuthorizeServiceActionInput): ServiceActionAuthorizationDto {
    const targetId = text(input.targetId, "target", 128);
    const requestKey = text(input.requestKey, "request key", 256);
    if (!["start", "stop", "restart", "recover"].includes(input.action)) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Unsupported service action");
    }
    const context = parseContext(input.context);
    if (context.action !== input.action) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Action context does not match");
    }
    const service = serviceOpsRow(this.#db, targetId);
    if (!service) throw new DeploymentError("NOT_FOUND", "Formal service was not found");
    if (context.projectId !== service.projectId || context.targetId !== targetId) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action is outside scope");
    }
    const existing = this.#byRequestKey(requestKey);
    if (existing) {
      if (existing.targetId !== targetId || existing.action !== input.action) {
        throw new DeploymentError("DEPLOY_CONFLICT", "Request key belongs to another action");
      }
      return dto(existing);
    }
    if (!service.currentArtifactId || !service.currentVersion) {
      throw new DeploymentError("DEPLOY_CONFLICT", "Formal service has no active version");
    }
    const artifactHash = this.#artifactHash(service.currentArtifactId);
    if (!artifactHash) throw new DeploymentError("DEPLOY_ARTIFACT_INVALID", "Artifact is missing");
    const decision = decideDeploymentAccess(context.policy, "L2");
    const status = decision === "allow" ? "AUTHORIZED" : decision === "deny" ? "DENIED" : "PENDING";
    const scope = {
      domain: "service-ops" as const,
      projectId: service.projectId,
      targetId,
      action: input.action,
      artifactHash,
      version: service.currentVersion,
    };
    ServiceActionScopeSchema.parse(scope);
    const scopeJson = canonicalJson(scope);
    const now = this.#now();
    const row: ServiceActionAuthorizationRow = {
      id: newId("sauth"),
      targetId,
      projectId: service.projectId,
      action: input.action,
      actorType: context.actor.type,
      actorId: context.actor.id,
      clientSessionId: context.clientSessionId,
      sessionId: context.sessionId,
      turnId: context.turnId,
      policy: context.policy,
      policySnapshotId: context.policySnapshotId,
      status,
      artifactHash,
      version: service.currentVersion,
      scopeJson,
      scopeHash: sha256(scopeJson),
      requestKey,
      expiresAt: now + DEPLOYMENT_APPROVAL_TTL_MS,
      decidedAt: status === "PENDING" ? null : now,
      decidedBy: status === "PENDING" ? null : context.actor.id,
      consumedAt: null,
      consumeKey: null,
      reasonCode: status === "DENIED" ? "POLICY_DENIED" : null,
      createdAt: now,
    };
    immediateTransaction(this.#db, (tx) => {
      tx.insert(serviceActionAuthorizations).values(row).run();
      this.#audit(tx, {
        action: "service.action.authorization.requested",
        decision: "info",
        row,
        context,
        now,
      });
      if (status === "AUTHORIZED") {
        this.#audit(tx, {
          action: "service.action.authorization.granted",
          decision: "allow",
          row,
          context,
          now,
        });
      } else if (status === "DENIED") {
        this.#audit(tx, {
          action: "service.action.authorization.denied",
          decision: "deny",
          row,
          context,
          now,
        });
      }
    });
    return dto(row);
  }

  decide(input: {
    authorizationId: string;
    decision: "approve" | "reject";
    decidedBy: string;
  }): ServiceActionAuthorizationDto {
    const id = text(input.authorizationId, "authorization", 128);
    const decidedBy = text(input.decidedBy, "decided by", 128);
    const now = this.#now();
    const row = this.#require(id);
    if (row.status === "PENDING" && row.expiresAt <= now) {
      this.#expire(row, now);
      throw new DeploymentError("DEPLOY_APPROVAL_EXPIRED", "Service action authorization expired");
    }
    if (row.status !== "PENDING") {
      throw new DeploymentError("DEPLOY_APPROVAL_INVALID", "Service action is not pending");
    }
    const service = serviceOpsRow(this.#db, row.targetId);
    if (
      !service ||
      service.currentArtifactId === null ||
      service.currentVersion !== row.version ||
      this.#artifactHash(service.currentArtifactId) !== row.artifactHash
    ) {
      this.#invalidate(row, "SERVICE_CHANGED", now);
      throw new DeploymentError("DEPLOY_CONFLICT", "Formal service changed");
    }
    const status = input.decision === "approve" ? "AUTHORIZED" : "DENIED";
    immediateTransaction(this.#db, (tx) => {
      tx.update(serviceActionAuthorizations)
        .set({
          status,
          decidedAt: now,
          decidedBy,
          reasonCode: input.decision === "reject" ? "APPROVAL_DENIED" : null,
        })
        .where(eq(serviceActionAuthorizations.id, id))
        .run();
      this.#audit(tx, {
        action:
          input.decision === "approve"
            ? "service.action.authorization.granted"
            : "service.action.authorization.denied",
        decision: input.decision === "approve" ? "allow" : "deny",
        row: { ...row, status, decidedAt: now, decidedBy },
        context: this.#context(row),
        now,
      });
    });
    return dto(this.#require(id));
  }

  consume(input: {
    authorizationId: string;
    consumeKey: string;
    context: unknown;
  }): ServiceActionAuthorizationDto {
    const id = text(input.authorizationId, "authorization", 128);
    const consumeKey = text(input.consumeKey, "consume key", 256);
    const context = parseContext(input.context);
    const row = this.#require(id);
    if (row.status === "CONSUMED") {
      if (row.consumeKey === consumeKey) return dto(row);
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action was already consumed");
    }
    if (row.status !== "AUTHORIZED") {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action is not authorized");
    }
    if (row.expiresAt <= this.#now()) {
      this.#expire(row, this.#now());
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action authorization expired");
    }
    if (!contextMatches(row, context)) {
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action context does not match");
    }
    const service = serviceOpsRow(this.#db, row.targetId);
    if (
      !service ||
      service.currentArtifactId === null ||
      service.currentVersion !== row.version ||
      this.#artifactHash(service.currentArtifactId) !== row.artifactHash
    ) {
      this.#invalidate(row, "SERVICE_CHANGED", this.#now());
      throw new DeploymentError("DEPLOY_CONFLICT", "Formal service changed");
    }
    const now = this.#now();
    immediateTransaction(this.#db, (tx) => {
      tx.update(serviceActionAuthorizations)
        .set({ status: "CONSUMED", consumedAt: now, consumeKey })
        .where(eq(serviceActionAuthorizations.id, id))
        .run();
      this.#audit(tx, {
        action: "service.action.authorization.consumed",
        decision: "allow",
        row: { ...row, status: "CONSUMED", consumedAt: now },
        context,
        now,
      });
    });
    return dto(this.#require(id));
  }

  get(id: string): ServiceActionAuthorizationDto {
    const row = this.#require(text(id, "authorization", 128));
    if ((row.status === "PENDING" || row.status === "AUTHORIZED") && row.expiresAt <= this.#now()) {
      this.#expire(row, this.#now());
      return dto(this.#require(row.id));
    }
    return dto(row);
  }

  recoverExpired(): number {
    const now = this.#now();
    const rows = this.#db
      .select()
      .from(serviceActionAuthorizations)
      .where(eq(serviceActionAuthorizations.status, "PENDING"))
      .all();
    let count = 0;
    for (const row of rows) {
      if (row.expiresAt <= now) {
        this.#expire(row, now);
        count += 1;
      }
    }
    return count;
  }

  #byRequestKey(key: string): ServiceActionAuthorizationRow | null {
    return (
      this.#db
        .select()
        .from(serviceActionAuthorizations)
        .where(eq(serviceActionAuthorizations.requestKey, key))
        .get() ?? null
    );
  }

  #require(id: string): ServiceActionAuthorizationRow {
    const row =
      this.#db
        .select()
        .from(serviceActionAuthorizations)
        .where(eq(serviceActionAuthorizations.id, id))
        .get() ?? null;
    if (!row)
      throw new DeploymentError("DEPLOY_AUTH_INVALID", "Service action authorization missing");
    return row;
  }

  #artifactHash(artifactId: string): string | null {
    const row = this.#db
      .select({ hash: deploymentArtifacts.artifactHash })
      .from(deploymentArtifacts)
      .where(eq(deploymentArtifacts.id, artifactId))
      .get();
    return row?.hash ?? null;
  }

  #expire(row: ServiceActionAuthorizationRow, now: number): void {
    immediateTransaction(this.#db, (tx) => {
      tx.update(serviceActionAuthorizations)
        .set({ status: "EXPIRED", reasonCode: "AUTHORIZATION_EXPIRED" })
        .where(eq(serviceActionAuthorizations.id, row.id))
        .run();
      this.#audit(tx, {
        action: "service.action.authorization.expired",
        decision: "deny",
        row,
        context: this.#context(row),
        now,
      });
    });
  }

  #invalidate(row: ServiceActionAuthorizationRow, reason: string, now: number): void {
    immediateTransaction(this.#db, (tx) => {
      tx.update(serviceActionAuthorizations)
        .set({ status: "DENIED", reasonCode: reason })
        .where(eq(serviceActionAuthorizations.id, row.id))
        .run();
      this.#audit(tx, {
        action: "service.action.authorization.invalidated",
        decision: "deny",
        row,
        context: this.#context(row),
        now,
      });
    });
  }

  #context(row: ServiceActionAuthorizationRow): DeploymentAuthorizationContext {
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
      row: ServiceActionAuthorizationRow;
      context?: DeploymentAuthorizationContext | undefined;
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
      resourceType: "service_action_authorization",
      resourceId: input.row.id,
      details: {
        targetId: input.row.targetId,
        action: input.row.action,
        version: input.row.version,
        artifactHash: input.row.artifactHash,
        policy: input.row.policy,
        policySnapshotId: input.row.policySnapshotId,
      },
      now: input.now,
    });
  }
}
