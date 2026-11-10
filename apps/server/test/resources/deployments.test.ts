import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  DEPLOYMENT_PLAN_TTL_MS,
  type DeploymentSpec,
  DeploymentSpecSchema,
  DeploymentTargetRefSchema,
} from "@larness/shared";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  type DeploymentBuildRow,
  deploymentBuilds,
  deploymentTargets,
} from "../../src/db/schema.js";
import { acquireResourceLock, releaseResourceLock } from "../../src/modules/locks/service.js";
import { createProject } from "../../src/modules/projects/service.js";
import {
  DeploymentManager,
  type DeploymentManagerOptions,
  deploymentArtifactRoot,
} from "../../src/modules/service-ops/deployments.js";
import { withTempDir } from "../helpers.js";

const BUILD_SCRIPT = `
import { appendFile, mkdir, writeFile } from "node:fs/promises";
const version = process.argv[2] ?? "v1";
await mkdir("dist", { recursive: true });
await writeFile("dist/main.js", "console.log(" + JSON.stringify(version) + ");\\n");
await writeFile("dist/assets.txt", "asset-" + version);
await appendFile("runs.txt", "run\\n");
console.log("built " + version);
`;

interface Fixture {
  dataDir: string;
  root: string;
  projectId: string;
  db: ReturnType<typeof openDatabase>["db"];
  manager: DeploymentManager;
  close(): void;
}

async function fixture(
  dir: string,
  options: Omit<Partial<DeploymentManagerOptions>, "db" | "dataDir"> = {},
): Promise<Fixture> {
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
  const manager = new DeploymentManager({ ...options, db: opened.db, dataDir });
  return {
    dataDir,
    root,
    projectId: project.id,
    db: opened.db,
    manager,
    close: () => {
      void manager.close();
      opened.sqlite.close();
    },
  };
}

function spec(overrides: Partial<DeploymentSpec> = {}): DeploymentSpec {
  return {
    version: "v1",
    build: {
      command: [process.execPath, "build.mjs", "v1"],
      cwd: ".",
      outputDir: "dist",
      timeoutMs: 30_000,
    },
    start: { command: [process.execPath, "main.js"], cwd: "." },
    health: { path: "/api/health", port: 4100, timeoutMs: 5_000, intervalMs: 200 },
    recovery: { strategy: "restart", maxAttempts: 2 },
    ...overrides,
  };
}

function buildInput(projectId: string, value: DeploymentSpec, key = newId("req")) {
  return {
    projectId,
    target: { name: "web" },
    spec: value,
    requestKey: key,
    requestedBy: "client-test",
  };
}

async function waitForFile(file: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await stat(file);
      return;
    } catch {
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for ${file}`);
}

describe("deployment target validation", () => {
  it("rejects development service, terminal, command and endpoint identities as formal targets", () => {
    expect(DeploymentTargetRefSchema.safeParse({ serviceId: `svc_${randomUUID()}` }).success).toBe(
      false,
    );
    expect(DeploymentTargetRefSchema.safeParse({ terminalId: `trm_${randomUUID()}` }).success).toBe(
      false,
    );
    expect(DeploymentTargetRefSchema.safeParse({ targetId: `svc_${randomUUID()}` }).success).toBe(
      false,
    );
    expect(
      DeploymentTargetRefSchema.safeParse({ endpoint: { host: "127.0.0.1", port: 5173 } }).success,
    ).toBe(false);
    expect(DeploymentTargetRefSchema.safeParse({ name: "web", port: 5173 }).success).toBe(false);
  });

  it("rejects an existing target that belongs to another project", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const otherRoot = path.join(dir, "other");
        await mkdir(otherRoot);
        const other = await createProject(
          { db: f.db, detectGit: async () => false },
          { rootPath: otherRoot },
        );
        expect(() =>
          f.manager.resolveTarget({
            projectId: other.id,
            target: { targetId: target.id },
          }),
        ).toThrowError(expect.objectContaining({ code: "DEPLOY_TARGET_INVALID" }));
      } finally {
        f.close();
      }
    });
  });
});

describe("deployment build and artifact", () => {
  it("builds a real project into an immutable content-addressed artifact", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        expect(build.status).toBe("SUCCEEDED");
        expect(build.targetId).toBe(target.id);
        const artifact = f.manager.artifactForBuild(build.id);
        expect(artifact).not.toBeNull();
        if (!artifact) throw new Error("missing artifact");
        expect(artifact.version).toBe("v1");
        expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
        expect(artifact.fileCount).toBe(2);
        expect(artifact.source).toEqual({ branch: null, commit: null, dirty: null });

        const payload = path.join(
          deploymentArtifactRoot(f.dataDir),
          target.id,
          artifact.id,
          "payload",
        );
        expect(await readFile(path.join(payload, "main.js"), "utf8")).toContain("v1");
        expect(await readFile(path.join(payload, "assets.txt"), "utf8")).toBe("asset-v1");
        if (process.platform !== "win32")
          expect((await stat(path.join(payload, "main.js"))).mode & 0o777).toBe(0o400);
        expect(await f.manager.verifyArtifact(artifact.id)).toEqual({ valid: true });
        const log = await f.manager.readBuildLog(build.id);
        expect(log).toContain("built v1");
      } finally {
        f.close();
      }
    });
  });

  it("reuses a completed build for the same request key without spawning again", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const input = buildInput(f.projectId, spec(), "same-request");
        const first = await f.manager.build(input);
        const second = await f.manager.build(input);
        expect(second.id).toBe(first.id);
        expect(await readFile(path.join(f.root, "runs.txt"), "utf8")).toBe("run\n");
        expect(f.manager.artifactForBuild(second.id)?.id).toBe(
          f.manager.artifactForBuild(first.id)?.id,
        );
      } finally {
        f.close();
      }
    });
  });

  it("records a real build failure without an artifact and keeps the target unchanged", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        await writeFile(
          path.join(f.root, "build.mjs"),
          'console.error("boom-marker"); process.exit(2);\n',
        );
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        expect(build.status).toBe("FAILED");
        expect(build.reasonCode).toBe("BUILD_FAILED");
        expect(f.manager.artifactForBuild(build.id)).toBeNull();
        const current = f.manager.resolveTarget({
          projectId: f.projectId,
          target: { targetId: target.id },
        });
        expect(current.currentArtifactId).toBeNull();
        expect(current.currentVersion).toBeNull();
        expect(await f.manager.readBuildLog(build.id)).toContain("boom-marker");
      } finally {
        f.close();
      }
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects an output directory containing a symlink outside the project",
    async () => {
      await withTempDir(async (dir) => {
        const f = await fixture(dir);
        try {
          await writeFile(path.join(dir, "outside.txt"), "outside");
          await writeFile(
            path.join(f.root, "build.mjs"),
            [
              'import { mkdir, symlink } from "node:fs/promises";',
              'await mkdir("dist", { recursive: true });',
              `await symlink(${JSON.stringify(path.join(dir, "outside.txt"))}, "dist/leak.txt");`,
              "",
            ].join("\n"),
          );
          const build = await f.manager.build(buildInput(f.projectId, spec()));
          expect(build.status).toBe("FAILED");
          expect(build.reasonCode).toBe("OUTPUT_INVALID");
          expect(f.manager.artifactForBuild(build.id)).toBeNull();
        } finally {
          f.close();
        }
      });
    },
  );

  it("enforces artifact size limits and removes the staging output", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir, { maxArtifactBytes: 8 });
      try {
        await writeFile(
          path.join(f.root, "build.mjs"),
          [
            'import { mkdir, writeFile } from "node:fs/promises";',
            'await mkdir("dist", { recursive: true });',
            'await writeFile("dist/large.txt", "0123456789");',
            "",
          ].join("\n"),
        );
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        expect(build.status).toBe("FAILED");
        expect(build.reasonCode).toBe("LIMIT_EXCEEDED");
        expect(f.manager.artifactForBuild(build.id)).toBeNull();
      } finally {
        f.close();
      }
    });
  });

  it("cancels a running build and keeps no artifact", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        await writeFile(
          path.join(f.root, "build.mjs"),
          [
            'import { writeFile } from "node:fs/promises";',
            'await writeFile("started.txt", "1");',
            "await new Promise((resolve) => setTimeout(resolve, 60000));",
            "",
          ].join("\n"),
        );
        const controller = new AbortController();
        const pending = f.manager.build({
          ...buildInput(f.projectId, spec()),
          signal: controller.signal,
        });
        await waitForFile(path.join(f.root, "started.txt"));
        controller.abort();
        const build = await pending;
        expect(build.status).toBe("CANCELLED");
        expect(build.reasonCode).toBe("CANCELLED");
        expect(f.manager.artifactForBuild(build.id)).toBeNull();
      } finally {
        f.close();
      }
    });
  }, 30_000);

  it("times out a running build, records TIMED_OUT and keeps no artifact", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        await writeFile(
          path.join(f.root, "build.mjs"),
          [
            'import { writeFile } from "node:fs/promises";',
            'await writeFile("started.txt", "1");',
            "await new Promise((resolve) => setTimeout(resolve, 60000));",
            "",
          ].join("\n"),
        );
        const value = spec();
        value.build.timeoutMs = 1000;
        const build = await f.manager.build(buildInput(f.projectId, value));
        expect(build.status).toBe("FAILED");
        expect(build.reasonCode).toBe("TIMED_OUT");
        expect(f.manager.artifactForBuild(build.id)).toBeNull();
      } finally {
        f.close();
      }
    });
  }, 30_000);

  it("does not inherit server secrets and redacts build output", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      const marker = "larness-m4-secret-marker";
      const previous = process.env.LARNESS_M4_TEST_SECRET;
      process.env.LARNESS_M4_TEST_SECRET = marker;
      try {
        await writeFile(
          path.join(f.root, "build.mjs"),
          [
            'import { mkdir, writeFile } from "node:fs/promises";',
            'console.log("token=do-not-leak");',
            'console.log("env", process.env.LARNESS_M4_TEST_SECRET ?? "absent");',
            'await mkdir("dist", { recursive: true });',
            'await writeFile("dist/main.js", "ok");',
            "",
          ].join("\n"),
        );
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        const log = await f.manager.readBuildLog(build.id);
        expect(log).toContain("[Redacted]");
        expect(log).toContain("absent");
        expect(log).not.toContain("do-not-leak");
        expect(log).not.toContain(marker);
      } finally {
        if (previous === undefined) delete process.env.LARNESS_M4_TEST_SECRET;
        else process.env.LARNESS_M4_TEST_SECRET = previous;
        f.close();
      }
    });
  });

  it("rejects a build while another project writer holds the lock", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      const lock = acquireResourceLock(
        { db: f.db },
        {
          resourceType: "project",
          resourceId: f.projectId,
          owner: "other",
          executionId: "other",
          ttlMs: 30_000,
          rootRealPath: f.root,
        },
      );
      try {
        if (!lock) throw new Error("lock not acquired");
        await expect(f.manager.build(buildInput(f.projectId, spec()))).rejects.toMatchObject({
          code: "RESOURCE_LOCKED",
        });
        expect(
          f.manager.resolveTarget({ projectId: f.projectId, target: { name: "web" } }).id,
        ).toBeTruthy();
      } finally {
        if (lock)
          releaseResourceLock({ db: f.db }, { id: lock.id, fencingToken: lock.fencingToken });
        f.close();
      }
    });
  });

  it("captures the real Git source snapshot when the project has a repository", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const { runGit, gitAvailable } = await import("@larness/resources");
        if (!(await gitAvailable())) return;
        await runGit(f.root, ["init", "-b", "main"], { readOnly: true, timeoutMs: 5000 });
        await runGit(f.root, ["config", "user.email", "test@example.com"], { timeoutMs: 5000 });
        await runGit(f.root, ["config", "user.name", "Test"], { timeoutMs: 5000 });
        await writeFile(path.join(f.root, ".gitignore"), "dist\nruns.txt\n");
        await runGit(f.root, ["add", ".gitignore", "build.mjs"], { timeoutMs: 5000 });
        await runGit(f.root, ["commit", "-m", "fixture"], { timeoutMs: 5000 });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        expect(build.status).toBe("SUCCEEDED");
        const artifact = f.manager.artifactForBuild(build.id);
        expect(artifact?.source.branch).toBe("main");
        expect(artifact?.source.commit).toMatch(/^[a-f0-9]{40}$/);
        expect(artifact?.source.dirty).toBe(false);
      } finally {
        f.close();
      }
    });
  });
});

describe("deployment plan", () => {
  it("creates a deterministic plan hash and binds the first deployment", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        const artifact = f.manager.artifactForBuild(build.id);
        if (!artifact) throw new Error("missing artifact");
        const plan = f.manager.createPlan({
          artifactId: artifact.id,
          requestKey: "plan-1",
          requestedBy: "client-test",
        });
        expect(plan.targetId).toBe(target.id);
        expect(plan.version).toBe("v1");
        expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.plan.impact.firstDeploy).toBe(true);
        expect(plan.plan.impact.replacesVersion).toBeNull();
        expect(plan.plan.recovery.databaseRollback).toBe("unsupported");
        expect(plan.plan.recovery.previousArtifactAvailable).toBe(false);
        expect(await f.manager.verifyPlan(plan.id)).toMatchObject({ valid: true });
      } finally {
        f.close();
      }
    });
  });

  it("binds the previous and next version when replacing a deployment", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const first = await f.manager.build(buildInput(f.projectId, spec()));
        const firstArtifact = f.manager.artifactForBuild(first.id);
        if (!firstArtifact) throw new Error("missing first artifact");
        f.db
          .update(deploymentTargets)
          .set({
            currentArtifactId: firstArtifact.id,
            currentVersion: firstArtifact.version,
            updatedAt: Date.now(),
          })
          .where(eq(deploymentTargets.id, target.id))
          .run();

        const secondSpec = spec();
        secondSpec.version = "v2";
        secondSpec.build.command = [process.execPath, "build.mjs", "v2"];
        const second = await f.manager.build(buildInput(f.projectId, secondSpec));
        const secondArtifact = f.manager.artifactForBuild(second.id);
        if (!secondArtifact) throw new Error("missing second artifact");
        const plan = f.manager.createPlan({
          artifactId: secondArtifact.id,
          requestKey: "plan-v2",
          requestedBy: "client-test",
          expectedCurrentArtifactId: firstArtifact.id,
        });
        expect(plan.previousArtifactId).toBe(firstArtifact.id);
        expect(plan.previousVersion).toBe("v1");
        expect(plan.plan.impact.firstDeploy).toBe(false);
        expect(plan.plan.impact.replacesVersion).toBe("v1");
        expect(plan.plan.recovery.previousArtifactAvailable).toBe(true);
      } finally {
        f.close();
      }
    });
  });

  it("rejects a no-change plan and an expected-current mismatch", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        const artifact = f.manager.artifactForBuild(build.id);
        if (!artifact) throw new Error("missing artifact");
        f.db
          .update(deploymentTargets)
          .set({
            currentArtifactId: artifact.id,
            currentVersion: artifact.version,
            updatedAt: Date.now(),
          })
          .where(eq(deploymentTargets.id, target.id))
          .run();
        expect(() =>
          f.manager.createPlan({
            artifactId: artifact.id,
            requestKey: "no-change",
            requestedBy: "client-test",
          }),
        ).toThrowError(expect.objectContaining({ code: "DEPLOY_CONFLICT" }));
        expect(() =>
          f.manager.createPlan({
            artifactId: artifact.id,
            requestKey: "mismatch",
            requestedBy: "client-test",
            expectedCurrentArtifactId: "art_00000000-0000-4000-8000-000000000000",
          }),
        ).toThrowError(expect.objectContaining({ code: "DEPLOY_CONFLICT" }));
      } finally {
        f.close();
      }
    });
  });

  it("expires plans and rejects an empty or inconsistent plan document", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        let now = 1_700_000_000_000;
        const manager = new DeploymentManager({
          db: f.db,
          dataDir: f.dataDir,
          now: () => now,
        });
        manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await manager.build(buildInput(f.projectId, spec()));
        const artifact = manager.artifactForBuild(build.id);
        if (!artifact) throw new Error("missing artifact");
        const plan = manager.createPlan({
          artifactId: artifact.id,
          requestKey: "expiring",
          requestedBy: "client-test",
        });
        expect(plan.expiresAt).toBe(now + DEPLOYMENT_PLAN_TTL_MS);
        now += DEPLOYMENT_PLAN_TTL_MS + 1;
        expect(manager.getPlan(plan.id).status).toBe("EXPIRED");
        expect(await manager.verifyPlan(plan.id)).toMatchObject({ valid: false });
        manager.close();
      } finally {
        f.close();
      }
    });
  });

  it("detects artifact and plan tampering", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const build = await f.manager.build(buildInput(f.projectId, spec()));
        const artifact = f.manager.artifactForBuild(build.id);
        if (!artifact) throw new Error("missing artifact");
        const plan = f.manager.createPlan({
          artifactId: artifact.id,
          requestKey: "tamper",
          requestedBy: "client-test",
        });
        expect(await f.manager.verifyPlan(plan.id)).toMatchObject({ valid: true });
        const payload = path.join(
          deploymentArtifactRoot(f.dataDir),
          target.id,
          artifact.id,
          "payload",
          "main.js",
        );
        await chmod(payload, 0o600);
        await writeFile(payload, "tampered");
        expect(await f.manager.verifyArtifact(artifact.id)).toMatchObject({
          valid: false,
          code: "ARTIFACT_HASH_MISMATCH",
        });
        expect(await f.manager.verifyPlan(plan.id)).toMatchObject({ valid: false });

        const row = f.db
          .select()
          .from(deploymentTargets)
          .where(eq(deploymentTargets.id, target.id))
          .get();
        expect(row?.currentArtifactId).toBeNull();
      } finally {
        f.close();
      }
    });
  });

  it("marks a residual RUNNING build as interrupted without creating an artifact", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const target = f.manager.ensureTarget({ projectId: f.projectId, name: "web" });
        const value = spec();
        const buildId = newId("bld");
        const now = Date.now();
        const row: DeploymentBuildRow = {
          id: buildId,
          targetId: target.id,
          projectId: f.projectId,
          requestKey: "interrupted",
          requestedBy: "client-test",
          status: "RUNNING",
          specJson: JSON.stringify(value),
          specHash: "0".repeat(64),
          reasonCode: null,
          logRef: `logs/deploy/${buildId}.log`,
          startedAt: now,
          endedAt: null,
          createdAt: now,
        };
        f.db.insert(deploymentBuilds).values(row).run();
        expect(f.manager.recover()).toBe(1);
        const recovered = f.db
          .select()
          .from(deploymentBuilds)
          .where(eq(deploymentBuilds.id, buildId))
          .get();
        expect(recovered?.status).toBe("FAILED");
        expect(recovered?.reasonCode).toBe("INTERRUPTED");
        expect(f.manager.artifactForBuild(buildId)).toBeNull();
      } finally {
        f.close();
      }
    });
  });
});

describe("deployment input validation", () => {
  it("rejects traversal, absolute paths, root output, invalid health and reserved ports", async () => {
    const base = spec();
    expect(
      DeploymentSpecSchema.safeParse({ ...base, build: { ...base.build, outputDir: "../dist" } })
        .success,
    ).toBe(false);
    expect(
      DeploymentSpecSchema.safeParse({ ...base, build: { ...base.build, outputDir: "/tmp/dist" } })
        .success,
    ).toBe(false);
    expect(
      DeploymentSpecSchema.safeParse({ ...base, build: { ...base.build, outputDir: "." } }).success,
    ).toBe(false);
    expect(
      DeploymentSpecSchema.safeParse({ ...base, health: { ...base.health, path: "/../admin" } })
        .success,
    ).toBe(false);
    expect(
      DeploymentSpecSchema.safeParse({ ...base, health: { ...base.health, port: 80 } }).success,
    ).toBe(false);
    expect(DeploymentSpecSchema.safeParse({ ...base, extra: true }).success).toBe(false);

    await withTempDir(async (dir) => {
      const f = await fixture(dir, { reservedPorts: [4100] });
      try {
        const value = spec();
        await expect(f.manager.build(buildInput(f.projectId, value))).rejects.toMatchObject({
          code: "DEPLOY_SPEC_INVALID",
        });
      } finally {
        f.close();
      }
    });
  });
});
