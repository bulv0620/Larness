import {
  type DeploymentAuthorizationContext,
  type DeploymentPolicy,
  ERROR_HTTP_STATUS,
  type ServiceOpsServiceDto,
} from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { newId } from "../db/ids.js";
import { HttpError } from "../errors.js";
import type { DeploymentAuthorizationService } from "../modules/service-ops/authorization.js";
import type { DeploymentManager } from "../modules/service-ops/deployments.js";
import type { DeploymentError } from "../modules/service-ops/errors.js";
import type { ServiceOpsRuntime } from "../modules/service-ops/serviceOps.js";
import { getSessionById } from "../modules/sessions/repository.js";

const IdSchema = z.string().min(1).max(128);
const KeySchema = z.string().min(1).max(256);
const PlanCreateSchema = z
  .object({
    artifactId: z.string().min(1).max(128),
    requestKey: KeySchema,
  })
  .strict();
const AuthorizationCreateSchema = z
  .object({
    planId: IdSchema,
    requestKey: KeySchema,
    sessionId: IdSchema.optional(),
  })
  .strict();
const ApprovalDecisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();
const ApplySchema = z
  .object({
    planId: IdSchema,
    authorizationId: IdSchema,
    consumeKey: KeySchema,
  })
  .strict();

export interface ServiceOpsApiDeps {
  db: Database;
  deployments: DeploymentManager;
  authorizations: DeploymentAuthorizationService;
  serviceOps: ServiceOpsRuntime;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError("VALIDATION_ERROR", "Invalid request");
  return parsed.data;
}

function deploymentError(error: unknown): never {
  if (error instanceof Error && "code" in error) {
    const code = (error as DeploymentError).code;
    throw new HttpError(code, error.message, { status: ERROR_HTTP_STATUS[code] });
  }
  throw error;
}

function policy(value: string): DeploymentPolicy {
  return value === "strict" || value === "readonly" || value === "autonomous" ? value : "standard";
}

export function registerServiceOpsRoutes(app: FastifyInstance, deps: ServiceOpsApiDeps): void {
  app.get("/api/service-ops/services", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    return { items: deps.serviceOps.listServices() };
  });

  app.get<{ Params: { id: string } }>("/api/service-ops/services/:id", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const id = parse(IdSchema, request.params.id);
    try {
      return deps.serviceOps.getService(id);
    } catch (error) {
      deploymentError(error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/service-ops/services/:id/deployments",
    async (request) => {
      if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
      const id = parse(IdSchema, request.params.id);
      return { items: deps.serviceOps.listDeployments(id) };
    },
  );

  app.get<{ Params: { id: string } }>("/api/service-ops/services/:id/logs", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const id = parse(IdSchema, request.params.id);
    try {
      return await deps.serviceOps.logs(id);
    } catch (error) {
      deploymentError(error);
    }
  });

  app.get("/api/service-ops/status", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    return { available: deps.serviceOps.available() };
  });

  app.post("/api/service-ops/plans", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const body = parse(PlanCreateSchema, request.body);
    try {
      return deps.deployments.createPlan({
        artifactId: body.artifactId,
        requestKey: body.requestKey,
        requestedBy: request.clientSession.id,
      });
    } catch (error) {
      deploymentError(error);
    }
  });

  app.post("/api/service-ops/authorizations", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const body = parse(AuthorizationCreateSchema, request.body);
    try {
      const plan = deps.deployments.getPlan(body.planId);
      let selectedPolicy: DeploymentPolicy = "standard";
      if (body.sessionId !== undefined) {
        const session = getSessionById(deps.db, body.sessionId);
        if (!session) throw new HttpError("VALIDATION_ERROR", "Session was not found");
        selectedPolicy = policy(session.approvalPolicyId);
      }
      const context: DeploymentAuthorizationContext = {
        domain: "service-ops",
        projectId: plan.projectId,
        targetId: plan.targetId,
        action: "apply",
        policy: selectedPolicy,
        policySnapshotId: newId("psnap"),
        actor: { type: "human", id: request.clientSession.id },
        clientSessionId: request.clientSession.id,
        sessionId: null,
        turnId: null,
      };
      return await deps.authorizations.authorizePlan({
        planId: body.planId,
        requestKey: body.requestKey,
        context,
      });
    } catch (error) {
      deploymentError(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/service-ops/approvals/:id", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const id = parse(IdSchema, request.params.id);
    const body = parse(ApprovalDecisionSchema, request.body);
    try {
      return await deps.authorizations.decideApproval({
        approvalId: id,
        decision: body.decision,
        decidedBy: request.clientSession.id,
      });
    } catch (error) {
      deploymentError(error);
    }
  });

  app.post("/api/service-ops/apply", async (request) => {
    if (!request.clientSession) throw new HttpError("UNAUTHENTICATED", "Authentication required");
    const body = parse(ApplySchema, request.body);
    const authorization = deps.authorizations.getAuthorization(body.authorizationId);
    if (authorization.clientSessionId !== request.clientSession.id) {
      throw new HttpError("FORBIDDEN", "Authorization belongs to another client");
    }
    const context: DeploymentAuthorizationContext = {
      domain: "service-ops",
      projectId: authorization.projectId,
      targetId: authorization.targetId,
      action: "apply",
      policy: authorization.policy,
      policySnapshotId: authorization.policySnapshotId,
      actor: { type: authorization.actorType, id: authorization.actorId },
      clientSessionId: authorization.clientSessionId,
      sessionId: authorization.sessionId,
      turnId: authorization.turnId,
    };
    try {
      return await deps.serviceOps.apply({
        planId: body.planId,
        authorizationId: body.authorizationId,
        consumeKey: body.consumeKey,
        context,
      });
    } catch (error) {
      deploymentError(error);
    }
  });
}

export type ServiceOpsServiceList = { items: ServiceOpsServiceDto[] };
