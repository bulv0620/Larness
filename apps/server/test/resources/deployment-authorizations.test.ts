import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEPLOYMENT_APPROVAL_TTL_MS, type DeploymentSpec } from "@larness/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import { auditLogs, deploymentApprovals, deploymentTargets } from "../../src/db/schema.js";
import { createProject } from "../../src/modules/projects/service.js";
import {
  DeploymentAuthorizationService,
  decideDeploymentAccess,
} from "../../src/modules/service-ops/authorization.js";
import {
  DeploymentManager,
  deploymentArtifactRoot,
} from "../../src/modules/service-ops/deployments.js";
import { withTempDir } from "../helpers.js";

const BUILD_SCRIPT = `
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await writeFile("dist/main.js", "console.log('v1');\\n");
`;

interface Fixture {
  dataDir: string;
  root: string;
  projectId: string;
  targetId: string;
  planId: string;
  artifactId: string;
  db: ReturnType<typeof openDatabase>["db"];
  manager: DeploymentManager;
  service: DeploymentAuthorizationService;
  setNow(value: number): void;
  close(): void;
}

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
    health: { path: "/api/health", port: 4100, timeoutMs: 5_000, intervalMs: 200 },
    recovery: { strategy: "restart", maxAttempts: 2 },
  };
}

async function fixture(dir: string): Promise<Fixture> {
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
  let now = 1_700_000_000_000;
  const manager = new DeploymentManager({ db: opened.db, dataDir, now: () => now });
  const target = manager.ensureTarget({ projectId: project.id, name: "web" });
  const build = await manager.build({
    projectId: project.id,
    target: { targetId: target.id },
    spec: spec(),
    requestKey: newId("req"),
    requestedBy: "client-1",
  });
  const artifact = manager.artifactForBuild(build.id);
  if (!artifact) throw new Error("missing artifact");
  const plan = manager.createPlan({
    artifactId: artifact.id,
    requestKey: newId("plan"),
    requestedBy: "client-1",
  });
  const service = new DeploymentAuthorizationService({
    db: opened.db,
    deployments: manager,
    now: () => now,
  });
  return {
    dataDir,
    root,
    projectId: project.id,
    targetId: target.id,
    planId: plan.id,
    artifactId: artifact.id,
    db: opened.db,
    manager,
    service,
    setNow: (value) => {
      now = value;
    },
    close: () => {
      void manager.close();
      opened.sqlite.close();
    },
  };
}

function context(
  fixture: Fixture,
  policy: "standard" | "strict" | "readonly" | "autonomous",
  overrides: Record<string, unknown> = {},
) {
  return {
    domain: "service-ops",
    projectId: fixture.projectId,
    targetId: fixture.targetId,
    action: "apply",
    policy,
    policySnapshotId: "psnap-1",
    actor: { type: "human", id: "client-1" },
    clientSessionId: "client-1",
    sessionId: null,
    turnId: null,
    ...overrides,
  };
}

function expectCode(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("deployment policy decisions", () => {
  it("matches the existing L0-L3 policy semantics", () => {
    expect(decideDeploymentAccess("standard", "L2")).toBe("require_approval");
    expect(decideDeploymentAccess("standard", "L1")).toBe("allow");
    expect(decideDeploymentAccess("strict", "L1")).toBe("require_approval");
    expect(decideDeploymentAccess("strict", "L3")).toBe("deny");
    expect(decideDeploymentAccess("readonly", "L2")).toBe("deny");
    expect(decideDeploymentAccess("readonly", "L0")).toBe("allow");
    expect(decideDeploymentAccess("autonomous", "L2")).toBe("allow");
  });
});

describe("deployment authorization", () => {
  it("waits for a real human approval under standard and consumes once", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const result = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-standard",
          context: context(f, "standard"),
        });
        expect(result.authorization.status).toBe("PENDING");
        expect(result.authorization.approvalId).toMatch(/^dapv_/);
        expect(result.approval?.status).toBe("PENDING");
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: result.authorization.id,
            requestKey: "consume-1",
            context: context(f, "standard"),
          }),
          "DEPLOY_AUTH_REQUIRED",
        );

        const decided = await f.service.decideApproval({
          approvalId: result.approval?.id ?? "",
          decision: "approve",
          decidedBy: "client-1",
        });
        expect(decided.authorization.status).toBe("AUTHORIZED");
        expect(decided.approval?.status).toBe("APPROVED");

        const consumed = await f.service.consumeAuthorization({
          authorizationId: result.authorization.id,
          requestKey: "consume-1",
          context: context(f, "standard"),
        });
        expect(consumed.status).toBe("CONSUMED");
        const again = await f.service.consumeAuthorization({
          authorizationId: result.authorization.id,
          requestKey: "consume-1",
          context: context(f, "standard"),
        });
        expect(again.status).toBe("CONSUMED");
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: result.authorization.id,
            requestKey: "consume-2",
            context: context(f, "standard"),
          }),
          "DEPLOY_AUTH_INVALID",
        );

        const audit = f.db.select().from(auditLogs).all();
        expect(audit.some((row) => row.action === "deployment.approval.granted")).toBe(true);
        expect(audit.some((row) => row.action === "deployment.authorization.consumed")).toBe(true);
      } finally {
        f.close();
      }
    });
  });

  it("rejects the plan after a human denial and for readonly", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const pending = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-reject",
          context: context(f, "strict"),
        });
        const denied = await f.service.decideApproval({
          approvalId: pending.approval?.id ?? "",
          decision: "reject",
          decidedBy: "client-1",
        });
        expect(denied.authorization.status).toBe("DENIED");
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: pending.authorization.id,
            requestKey: "consume-reject",
            context: context(f, "strict"),
          }),
          "DEPLOY_AUTH_INVALID",
        );

        const readonly = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-readonly",
          context: context(f, "readonly"),
        });
        expect(readonly.authorization.status).toBe("DENIED");
        expect(readonly.approval).toBeNull();
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: readonly.authorization.id,
            requestKey: "consume-readonly",
            context: context(f, "readonly"),
          }),
          "DEPLOY_AUTH_INVALID",
        );
      } finally {
        f.close();
      }
    });
  });

  it("records an autonomous authorization without a human approval record", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const result = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-auto",
          context: context(f, "autonomous"),
        });
        expect(result.authorization.status).toBe("AUTHORIZED");
        expect(result.authorization.approvalId).toBeNull();
        expect(result.approval).toBeNull();
        expect(f.db.select().from(deploymentApprovals).all()).toHaveLength(0);
        const audit = f.db.select().from(auditLogs).all();
        expect(
          audit.some(
            (row) => row.action === "deployment.authorization.granted" && row.decision === "allow",
          ),
        ).toBe(true);
        expect(audit.some((row) => row.action === "deployment.approval.granted")).toBe(false);

        const consumed = await f.service.consumeAuthorization({
          authorizationId: result.authorization.id,
          requestKey: "auto-consume",
          context: context(f, "autonomous"),
        });
        expect(consumed.status).toBe("CONSUMED");
      } finally {
        f.close();
      }
    });
  });

  it("expires plans, approvals and authorizations", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const pending = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-expiry",
          context: context(f, "standard"),
        });
        const now = Date.now();
        f.setNow(now + DEPLOYMENT_APPROVAL_TTL_MS + 1);
        await expectCode(
          f.service.decideApproval({
            approvalId: pending.approval?.id ?? "",
            decision: "approve",
            decidedBy: "client-1",
          }),
          "DEPLOY_APPROVAL_EXPIRED",
        );
        expect(f.service.getAuthorization(pending.authorization.id).status).toBe("EXPIRED");

        f.setNow(now + 31 * 60_000);
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "auth-expired-plan",
            context: context(f, "autonomous"),
          }),
          "DEPLOY_PLAN_EXPIRED",
        );
      } finally {
        f.close();
      }
    });
  });

  it("invalidates an approval when the plan is tampered with", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const pending = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-tamper",
          context: context(f, "standard"),
        });
        const row = f.db
          .select()
          .from(deploymentApprovals)
          .where(eq(deploymentApprovals.id, pending.approval?.id ?? ""))
          .get();
        expect(row).toBeDefined();
        const plan = f.db
          .select()
          .from(deploymentTargets)
          .where(eq(deploymentTargets.id, f.targetId))
          .get();
        expect(plan).toBeDefined();
        f.db
          .update(deploymentTargets)
          .set({ currentVersion: "v9", currentArtifactId: `art_${crypto.randomUUID()}` })
          .where(eq(deploymentTargets.id, f.targetId))
          .run();
        await expectCode(
          f.service.decideApproval({
            approvalId: pending.approval?.id ?? "",
            decision: "approve",
            decidedBy: "client-1",
          }),
          "DEPLOY_PLAN_INVALID",
        );
        expect(f.service.getAuthorization(pending.authorization.id).status).toBe("INVALIDATED");
      } finally {
        f.close();
      }
    });
  });

  it("revokes plans and authorizations and rejects further consumption", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const authorized = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-revoke",
          context: context(f, "autonomous"),
        });
        const revoked = f.service.revokeAuthorization({
          authorizationId: authorized.authorization.id,
          actor: "client-1",
          reason: "USER_REVOKED",
        });
        expect(revoked.status).toBe("REVOKED");
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: authorized.authorization.id,
            requestKey: "revoked-consume",
            context: context(f, "autonomous"),
          }),
          "DEPLOY_AUTH_INVALID",
        );

        const second = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-plan-revoke",
          context: context(f, "autonomous"),
        });
        expect(
          f.service.revokePlan({ planId: f.planId, actor: "client-1", reason: "PLAN_REVOKED" }),
        ).toEqual({
          invalidated: 1,
        });
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: second.authorization.id,
            requestKey: "plan-revoked-consume",
            context: context(f, "autonomous"),
          }),
          "DEPLOY_AUTH_INVALID",
        );
      } finally {
        f.close();
      }
    });
  });

  it("rejects scope, domain, actor and development approval identity mismatches", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "bad-domain",
            context: context(f, "standard", { domain: "development" }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "bad-project",
            context: context(f, "standard", { projectId: "prj_other" }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "bad-target",
            context: context(f, "standard", {
              targetId: `tgt_${crypto.randomUUID()}`,
            }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "bad-action",
            context: context(f, "standard", { action: "start" }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "missing-client",
            context: context(f, "standard", { clientSessionId: null }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
        await expectCode(
          f.service.decideApproval({
            approvalId: `apv_${crypto.randomUUID()}`,
            decision: "approve",
            decidedBy: "client-1",
          }),
          "DEPLOY_APPROVAL_INVALID",
        );

        const autonomous = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-scope",
          context: context(f, "autonomous"),
        });
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: autonomous.authorization.id,
            requestKey: "wrong-actor",
            context: context(f, "autonomous", { actor: { type: "human", id: "client-2" } }),
          }),
          "DEPLOY_AUTH_INVALID",
        );
      } finally {
        f.close();
      }
    });
  });

  it("invalidates an authorization when the artifact or target changes", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const artifact = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-artifact",
          context: context(f, "autonomous"),
        });
        const payload = path.join(
          deploymentArtifactRoot(f.dataDir),
          f.targetId,
          f.artifactId,
          "payload",
          "main.js",
        );
        await chmod(payload, 0o600);
        await writeFile(payload, "tampered");
        await expectCode(
          f.service.consumeAuthorization({
            authorizationId: artifact.authorization.id,
            requestKey: "tampered-consume",
            context: context(f, "autonomous"),
          }),
          "DEPLOY_ARTIFACT_INVALID",
        );
        expect(f.service.getAuthorization(artifact.authorization.id).status).toBe("INVALIDATED");
      } finally {
        f.close();
      }
    });
  });

  it("is idempotent for the same request key and rejects a different context", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const first = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-idem",
          context: context(f, "autonomous"),
        });
        const second = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-idem",
          context: context(f, "autonomous"),
        });
        expect(second.authorization.id).toBe(first.authorization.id);
        await expectCode(
          f.service.authorizePlan({
            planId: f.planId,
            requestKey: "auth-idem",
            context: context(f, "autonomous", { actor: { type: "human", id: "client-2" } }),
          }),
          "DEPLOY_CONFLICT",
        );
      } finally {
        f.close();
      }
    });
  });

  it("recovers pending approvals that expired while the server was down", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const pending = await f.service.authorizePlan({
          planId: f.planId,
          requestKey: "auth-recover",
          context: context(f, "standard"),
        });
        f.setNow(Date.now() + DEPLOYMENT_APPROVAL_TTL_MS + 1);
        expect(f.service.recoverExpired()).toBeGreaterThanOrEqual(1);
        expect(f.service.getAuthorization(pending.authorization.id).status).toBe("EXPIRED");
        expect(f.service.getApproval(pending.approval?.id ?? "").status).toBe("EXPIRED");
      } finally {
        f.close();
      }
    });
  });
});
