import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeploymentSpec } from "@larness/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import { serviceOpsServices, turns } from "../../src/db/schema.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listResourceEvents, ResourceEventBus } from "../../src/modules/resources/events.js";
import { DeploymentAuthorizationService } from "../../src/modules/service-ops/authorization.js";
import { DeploymentManager } from "../../src/modules/service-ops/deployments.js";
import { ensureGlobalPm2 } from "../../src/modules/service-ops/pm2.js";
import { ServiceActionAuthorizationService } from "../../src/modules/service-ops/serviceActions.js";
import { ServiceOpsRuntime } from "../../src/modules/service-ops/serviceOps.js";
import { serviceOpsRow } from "../../src/modules/service-ops/serviceOpsRepository.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const BUILD_SCRIPT = `
import { chmod, mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/main.js", "console.log('v1');\\n");
`;

function spec(): DeploymentSpec {
  return {
    version: "v1",
    build: {
      command: [process.execPath, "build.mjs"],
      cwd: ".",
      outputDir: "dist",
      timeoutMs: 30_000,
    },
    start: { command: [process.execPath, "main.js"], cwd: "." },
    health: { path: "/health", port: 45123, timeoutMs: 2_000, intervalMs: 100 },
    recovery: { strategy: "restart", maxAttempts: 2 },
  };
}

async function buildArtifact(
  manager: DeploymentManager,
  projectId: string,
): Promise<{ artifactId: string; targetId: string; planId: string }> {
  const target = manager.ensureTarget({ projectId, name: "web" });
  const build = await manager.build({
    projectId,
    target: { targetId: target.id },
    spec: spec(),
    requestKey: newId("req"),
    requestedBy: "client-test",
  });
  const artifact = manager.artifactForBuild(build.id);
  if (!artifact) throw new Error("missing artifact");
  const plan = manager.createPlan({
    artifactId: artifact.id,
    requestKey: newId("plan"),
    requestedBy: "client-test",
  });
  return { artifactId: artifact.id, targetId: target.id, planId: plan.id };
}

describe("service operations runtime without PM2", () => {
  it("records a failed apply, consumes authorization and persists a status event", async () => {
    await withTempDir(async (dir) => {
      const dataDir = path.join(dir, "data");
      const root = path.join(dir, "project");
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "build.mjs"), BUILD_SCRIPT);
      const opened = openDatabase(path.join(dataDir, "larness.db"));
      runMigrations(opened.db);
      const project = await createProject(
        { db: opened.db, detectGit: async () => false },
        { rootPath: root },
      );
      const manager = new DeploymentManager({ db: opened.db, dataDir });
      const authorizations = new DeploymentAuthorizationService({
        db: opened.db,
        deployments: manager,
      });
      const events = new ResourceEventBus();
      const runtime = new ServiceOpsRuntime({
        db: opened.db,
        dataDir,
        deployments: manager,
        authorizations,
        pm2: null,
        events,
      });
      try {
        const { planId, targetId, artifactId } = await buildArtifact(manager, project.id);
        const context = {
          domain: "service-ops",
          projectId: project.id,
          targetId,
          action: "apply",
          policy: "autonomous",
          policySnapshotId: "psnap-test",
          actor: { type: "human", id: "client-test" },
          clientSessionId: "client-test",
          sessionId: null,
          turnId: null,
        };
        const authorization = await authorizations.authorizePlan({
          planId,
          requestKey: "auth-apply",
          context,
        });
        const deployment = await runtime.apply({
          planId,
          authorizationId: authorization.authorization.id,
          consumeKey: "apply-1",
          context,
        });
        expect(deployment.status).toBe("FAILED");
        expect(deployment.reasonCode).toBe("PM2_UNAVAILABLE");
        expect(authorizations.getAuthorization(authorization.authorization.id).status).toBe(
          "CONSUMED",
        );
        const service = serviceOpsRow(opened.db, targetId);
        expect(service?.observedState).toBe("failed");
        expect(service?.reasonCode).toBe("PM2_UNAVAILABLE");
        expect(manager.getPlan(planId).status).toBe("FAILED");
        const eventsPage = await listResourceEvents(
          { db: opened.db, dataDir },
          { streamId: `ops:${targetId}`, after: 0, limit: 50 },
        );
        expect(eventsPage.items).toHaveLength(1);
        expect(eventsPage.items[0]).toMatchObject({
          topic: "service-ops",
          type: "service-ops.status",
          payload: { observedState: "failed", reasonCode: "PM2_UNAVAILABLE" },
        });
        expect(await runtime.reconcile()).toBe(1);

        opened.db
          .update(serviceOpsServices)
          .set({ currentArtifactId: artifactId, currentVersion: "v1" })
          .where(eq(serviceOpsServices.targetId, targetId))
          .run();
        const actionAuth = new ServiceActionAuthorizationService({ db: opened.db });
        const actionContext = {
          ...context,
          action: "restart" as const,
        };
        const autonomousAction = actionAuth.authorize({
          targetId,
          action: "restart",
          requestKey: "action-auto",
          context: actionContext,
        });
        expect(autonomousAction.status).toBe("AUTHORIZED");
        const consumedAction = actionAuth.consume({
          authorizationId: autonomousAction.id,
          consumeKey: "action-consume",
          context: actionContext,
        });
        expect(consumedAction.status).toBe("CONSUMED");
        await expect(runtime.executeAction(targetId, "restart")).rejects.toMatchObject({
          code: "DEPLOY_UNAVAILABLE",
        });
        const standardAction = actionAuth.authorize({
          targetId,
          action: "stop",
          requestKey: "action-standard",
          context: { ...context, action: "stop", policy: "standard" },
        });
        expect(standardAction.status).toBe("PENDING");
        const approvedAction = actionAuth.decide({
          authorizationId: standardAction.id,
          decision: "approve",
          decidedBy: "client-test",
        });
        expect(approvedAction.status).toBe("AUTHORIZED");
        const readonlyAction = actionAuth.authorize({
          targetId,
          action: "start",
          requestKey: "action-readonly",
          context: { ...context, action: "start", policy: "readonly" },
        });
        expect(readonlyAction.status).toBe("DENIED");
        const repeated = await runtime.apply({
          planId,
          authorizationId: authorization.authorization.id,
          consumeKey: "apply-1",
          context,
        });
        expect(repeated.id).toBe(deployment.id);
        expect(repeated.status).toBe("FAILED");
      } finally {
        opened.sqlite.close();
      }
    });
  });
});

describe("PM2 initialization failure", () => {
  it("reports an unwritable global prefix without installing", async () => {
    await withTempDir(async (dir) => {
      const prefix = path.join(dir, "readonly");
      await mkdir(prefix, { recursive: true });
      await chmod(prefix, 0o500);
      try {
        const result = await ensureGlobalPm2({ prefix });
        expect(result).toEqual({ status: "unavailable", reason: "permissions" });
      } finally {
        await chmod(prefix, 0o700);
      }
    });
  });
});

describe("service operations REST", () => {
  it("authenticates, enforces CSRF, and exposes plans, authorization, apply, logs and events", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);
      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const root = path.join(dir, "project");
        await mkdir(root);
        await writeFile(path.join(root, "build.mjs"), BUILD_SCRIPT);
        const project = await createProject(
          { db: started.running.db, detectGit: async () => false },
          { rootPath: root },
        );
        const { artifactId, targetId } = await buildArtifact(
          started.running.deployments,
          project.id,
        );

        const planResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/service-ops/plans",
          headers: auth,
          payload: { artifactId, requestKey: "rest-plan" },
        });
        expect(planResponse.statusCode).toBe(200);
        const plan = planResponse.json() as { id: string };

        const sessionResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: auth,
          payload: {},
        });
        const session = sessionResponse.json() as { id: string };
        const policyResponse = await started.running.app.inject({
          method: "PATCH",
          url: `/api/sessions/${session.id}`,
          headers: auth,
          payload: { approvalPolicyId: "autonomous" },
        });
        expect(policyResponse.statusCode).toBe(200);
        const authorizationResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/service-ops/authorizations",
          headers: auth,
          payload: { planId: plan.id, requestKey: "rest-auth", sessionId: session.id },
        });
        expect(authorizationResponse.statusCode).toBe(200);
        const authorization = authorizationResponse.json() as {
          authorization: { id: string; status: string };
        };
        expect(authorization.authorization.status).toBe("AUTHORIZED");

        const applyResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/service-ops/apply",
          headers: auth,
          payload: {
            planId: plan.id,
            authorizationId: authorization.authorization.id,
            consumeKey: "rest-apply",
          },
        });
        expect(applyResponse.statusCode).toBe(200);
        expect(applyResponse.json()).toMatchObject({
          status: "FAILED",
          reasonCode: "PM2_UNAVAILABLE",
        });

        started.running.db
          .update(serviceOpsServices)
          .set({ currentArtifactId: artifactId, currentVersion: "v1" })
          .where(eq(serviceOpsServices.targetId, targetId))
          .run();
        const actionResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/services/${targetId}/actions`,
          headers: auth,
          payload: { action: "restart", requestKey: "rest-action", sessionId: session.id },
        });
        expect(actionResponse.statusCode).toBe(200);
        const action = actionResponse.json() as { id: string; status: string };
        expect(action.status).toBe("AUTHORIZED");
        const executeResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/service-actions/${action.id}/execute`,
          headers: auth,
          payload: { consumeKey: "rest-action-exec" },
        });
        expect(executeResponse.statusCode).toBe(503);
        expect(executeResponse.json()).toMatchObject({ error: { code: "DEPLOY_UNAVAILABLE" } });

        const pendingActionResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/services/${targetId}/actions`,
          headers: auth,
          payload: { action: "stop", requestKey: "rest-action-standard" },
        });
        const pendingAction = pendingActionResponse.json() as { id: string; status: string };
        expect(pendingAction.status).toBe("PENDING");
        const actionDecision = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/service-actions/${pendingAction.id}/decision`,
          headers: auth,
          payload: { decision: "approve" },
        });
        expect(actionDecision.statusCode).toBe(200);
        expect(actionDecision.json()).toMatchObject({ status: "AUTHORIZED" });

        const agentTurnResponse = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/services/${targetId}/agent-turns`,
          headers: auth,
          payload: { sessionId: session.id, input: "检查正式服务并重启" },
        });
        expect(agentTurnResponse.statusCode).toBe(200);
        const agentTurn = agentTurnResponse.json() as {
          turnId: string;
          domain: string;
          targetId: string;
        };
        expect(agentTurn).toMatchObject({ domain: "service-ops", targetId });
        const turnRow = started.running.db
          .select()
          .from(turns)
          .where(eq(turns.id, agentTurn.turnId))
          .get();
        expect(turnRow?.inputJson).toContain('"domain":"service-ops"');

        const serviceResponse = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${targetId}`,
          headers: { cookie: started.cookie },
        });
        expect(serviceResponse.statusCode).toBe(200);
        expect(serviceResponse.json()).toMatchObject({
          targetId,
          observedState: "failed",
          reasonCode: "DEPLOY_UNAVAILABLE",
        });
        const listResponse = await started.running.app.inject({
          method: "GET",
          url: "/api/service-ops/services",
          headers: { cookie: started.cookie },
        });
        expect(listResponse.statusCode).toBe(200);
        expect(listResponse.json()).toMatchObject({ items: [{ targetId }] });
        const logsResponse = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${targetId}/logs`,
          headers: { cookie: started.cookie },
        });
        expect(logsResponse.statusCode).toBe(200);
        expect(logsResponse.json()).toMatchObject({ text: "" });
        const deploymentsResponse = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${targetId}/deployments`,
          headers: { cookie: started.cookie },
        });
        expect(deploymentsResponse.statusCode).toBe(200);
        expect(deploymentsResponse.json()).toMatchObject({
          items: [{ status: "FAILED", reasonCode: "PM2_UNAVAILABLE" }],
        });

        const eventsResponse = await started.running.app.inject({
          method: "GET",
          url: `/api/resource-events?streamId=ops:${targetId}&after=0`,
          headers: { cookie: started.cookie },
        });
        expect(eventsResponse.statusCode).toBe(200);
        const eventsBody = eventsResponse.json() as {
          items: { topic: string; type: string }[];
        };
        expect(
          eventsBody.items.some(
            (item) => item.topic === "service-ops" && item.type === "service-ops.status",
          ),
        ).toBe(true);

        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/service-ops/services",
        });
        expect(unauthenticated.statusCode).toBe(401);
        const noCsrf = await started.running.app.inject({
          method: "POST",
          url: "/api/service-ops/plans",
          headers: { cookie: started.cookie, origin: started.origin },
          payload: { artifactId, requestKey: "no-csrf" },
        });
        expect(noCsrf.statusCode).toBe(403);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
