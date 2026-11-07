import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { DeploymentSpec } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { startServer } from "../../src/bootstrap/start.js";
import { openDatabase } from "../../src/db/client.js";
import { newId } from "../../src/db/ids.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listResourceEvents, ResourceEventBus } from "../../src/modules/resources/events.js";
import { DeploymentAuthorizationService } from "../../src/modules/service-ops/authorization.js";
import { DeploymentManager } from "../../src/modules/service-ops/deployments.js";
import { ensureGlobalPm2, Pm2Adapter } from "../../src/modules/service-ops/pm2.js";
import { ServiceOpsRuntime } from "../../src/modules/service-ops/serviceOps.js";
import { serviceOpsRow } from "../../src/modules/service-ops/serviceOpsRepository.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

const BUILD_SCRIPT = `
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const [version, healthMode] = process.argv.slice(2);
await mkdir("dist", { recursive: true });
await writeFile("dist/main.js", [
  'import { createServer } from "node:http";',
  "const port = Number(process.env.PORT);",
  "const version = " + JSON.stringify(version) + ";",
  'createServer((request, response) => {',
  '  if (request.url === "/env") { response.end(process.env.LARNESS_M4_TEST_SECRET ?? "absent"); return; }',
  '  if (request.url === "/health") {',
  '    response.statusCode = ' + JSON.stringify(healthMode === "bad" ? 500 : 200) + ";",
  "    response.setHeader(\\"content-type\\", \\"application/json\\");",
  '    response.end(JSON.stringify({ ok: version }));',
  "    return;",
  "  }",
  '  response.end("ok");',
  '}).listen(port, "127.0.0.1", () => console.log("ready " + version));',
  "",
].join("\\n"));
`;

function spec(version: string, healthMode: "good" | "bad", port: number): DeploymentSpec {
  return {
    version,
    build: {
      command: [process.execPath, "build.mjs", version, healthMode],
      cwd: ".",
      outputDir: "dist",
      timeoutMs: 30_000,
    },
    start: { command: [process.execPath, "main.js"], cwd: "." },
    health: { path: "/health", port, timeoutMs: 3_000, intervalMs: 100 },
    recovery: { strategy: "restart", maxAttempts: 2 },
  };
}

const enabled = process.env.LARNESS_POC_PM2 === "1";

describe.skipIf(!enabled)("formal service PM2 lifecycle", () => {
  it("starts, replaces, rolls back a failed health check and reconciles a real PM2 service", async () => {
    await withTempDir(async (dir) => {
      const dataDir = path.join(dir, "data");
      const root = path.join(dir, "project");
      const secret = "m4-secret-marker";
      process.env.LARNESS_M4_TEST_SECRET = secret;
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "build.mjs"), BUILD_SCRIPT);
      const prefix = path.join(dir, "global");
      const global = await ensureGlobalPm2({ prefix });
      expect(global.status).toBe("ready");
      if (global.status !== "ready") return;
      const reused = await ensureGlobalPm2({ prefix });
      expect(reused).toMatchObject({ status: "ready", installed: false });
      const tuiPort = await getFreePort();
      const tui = await startServer({
        env: {
          LARNESS_DATA_DIR: path.join(dir, "tui-data"),
          LARNESS_PORT: String(tuiPort),
          LARNESS_PM2_AUTO_INSTALL: "1",
          LARNESS_PM2_PREFIX: prefix,
        },
        logDestination: createLogSink().stream,
        turnRunner: false,
      });
      try {
        expect(tui.pm2Global.status).toBe("ready");
        expect(tui.serviceOps.available()).toBe(true);
      } finally {
        await tui.shutdown("test");
      }

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
      const adapter = new Pm2Adapter(global, dataDir);
      const runtime = new ServiceOpsRuntime({
        db: opened.db,
        dataDir,
        deployments: manager,
        authorizations,
        pm2: adapter,
        events,
      });
      const port = await getFreePort();
      const target = manager.ensureTarget({ projectId: project.id, name: "web" });
      const context = {
        domain: "service-ops" as const,
        projectId: project.id,
        targetId: target.id,
        action: "apply" as const,
        policy: "autonomous" as const,
        policySnapshotId: "psnap-pm2",
        actor: { type: "human" as const, id: "client-pm2" },
        clientSessionId: "client-pm2",
        sessionId: null,
        turnId: null,
      };
      const applyVersion = async (version: string, mode: "good" | "bad") => {
        const build = await manager.build({
          projectId: project.id,
          target: { targetId: target.id },
          spec: spec(version, mode, port),
          requestKey: newId("req"),
          requestedBy: "client-pm2",
        });
        expect(build.status).toBe("SUCCEEDED");
        const artifact = manager.artifactForBuild(build.id);
        if (!artifact) throw new Error("missing artifact");
        const plan = manager.createPlan({
          artifactId: artifact.id,
          requestKey: newId("plan"),
          requestedBy: "client-pm2",
        });
        const authorization = await authorizations.authorizePlan({
          planId: plan.id,
          requestKey: newId("auth"),
          context,
        });
        expect(authorization.authorization.status).toBe("AUTHORIZED");
        return runtime.apply({
          planId: plan.id,
          authorizationId: authorization.authorization.id,
          consumeKey: newId("consume"),
          context,
        });
      };

      try {
        const first = await applyVersion("v1", "good");
        expect(first.status).toBe("SUCCEEDED");
        const envResponse = await fetch(`http://127.0.0.1:${port}/env`);
        expect(await envResponse.text()).toBe("absent");
        const firstHealth = await fetch(`http://127.0.0.1:${port}/health`);
        expect(firstHealth.ok).toBe(true);
        expect(await firstHealth.text()).toContain("v1");
        const firstService = serviceOpsRow(opened.db, target.id);
        expect(firstService).toMatchObject({
          observedState: "running",
          currentVersion: "v1",
          desiredState: "running",
        });
        expect(firstService?.pid).toBeGreaterThan(0);
        expect(manager.getPlan(first.planId).status).toBe("SUCCEEDED");
        await delay(200);
        expect((await runtime.logs(target.id)).text).toContain("ready v1");
        expect(await runtime.reconcile()).toBe(0);
        const firstEvents = await listResourceEvents(
          { db: opened.db, dataDir },
          { streamId: `ops:${target.id}`, after: 0, limit: 50 },
        );
        expect(firstEvents.items.some((item) => item.type === "service-ops.deployment")).toBe(true);

        const second = await applyVersion("v2", "good");
        expect(second.status).toBe("SUCCEEDED");
        expect(second.previousVersion).toBe("v1");
        expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toContain("v2");
        const secondService = serviceOpsRow(opened.db, target.id);
        expect(secondService).toMatchObject({ observedState: "running", currentVersion: "v2" });

        const failed = await applyVersion("v3", "bad");
        expect(failed.status).toBe("FAILED");
        expect(failed.reasonCode).toBe("HEALTH_FAILED_ROLLED_BACK");
        expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toContain("v2");
        const rolledBack = serviceOpsRow(opened.db, target.id);
        expect(rolledBack).toMatchObject({ observedState: "running", currentVersion: "v2" });

        await adapter.stop(`larness-${target.id}`);
        expect(await runtime.reconcile()).toBeGreaterThanOrEqual(1);
        expect(serviceOpsRow(opened.db, target.id)?.observedState).toBe("stopped");
      } finally {
        await adapter.close().catch(() => undefined);
        for (const file of [
          path.join(dataDir, "pm2", "dump.pm2"),
          path.join(dataDir, "pm2", "pm2.log"),
          path.join(dataDir, "logs", "deploy", `${target.id}.log`),
        ]) {
          if (existsSync(file)) expect(await readFile(file, "utf8")).not.toContain(secret);
        }
        delete process.env.LARNESS_M4_TEST_SECRET;
        opened.sqlite.close();
      }
    });
  }, 240_000);
});
