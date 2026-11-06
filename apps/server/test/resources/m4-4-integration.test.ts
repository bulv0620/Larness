import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeploymentSpec } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { createProject } from "../../src/modules/projects/service.js";
import { Pm2Adapter } from "../../src/modules/service-ops/pm2.js";
import { getFreePort, withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const BUILD_SCRIPT = `
import { mkdir, writeFile } from "node:fs/promises";
const [version, healthMode] = process.argv.slice(2);
await mkdir("dist", { recursive: true });
await writeFile("dist/main.js", [
  'import { createServer } from "node:http";',
  "const port = Number(process.env.PORT);",
  "const version = " + JSON.stringify(version) + ";",
  'createServer((request, response) => {',
  '  if (request.url === "/health") {',
  '    response.statusCode = ' + JSON.stringify(healthMode === "bad" ? 500 : 200) + ";",
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

describe.skipIf(!enabled)("M4-4 real integration", () => {
  it("publishes, manages and rolls back a formal service through authenticated REST", async () => {
    await withTempDir(async (dir) => {
      const prefix = path.join(dir, "global");
      const dataDir = path.join(dir, "data");
      const root = path.join(dir, "project");
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, "build.mjs"), BUILD_SCRIPT);
      const port = await getFreePort();
      const started = await startAuthorizedServer(dataDir, {
        env: {
          LARNESS_PM2_AUTO_INSTALL: "1",
          LARNESS_PM2_PREFIX: prefix,
        },
      });
      const auth = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      try {
        expect(started.running.pm2Global.status).toBe("ready");
        const project = await createProject(
          { db: started.running.db, detectGit: async () => false },
          { rootPath: root },
        );
        const target = started.running.deployments.ensureTarget({
          projectId: project.id,
          name: "web",
        });
        const sessionResponse = await started.running.app.inject({
          method: "POST",
          url: "/api/sessions",
          headers: auth,
          payload: {},
        });
        const session = sessionResponse.json() as { id: string };
        await started.running.app.inject({
          method: "PATCH",
          url: `/api/sessions/${session.id}`,
          headers: auth,
          payload: { approvalPolicyId: "autonomous" },
        });

        const applyVersion = async (version: string, mode: "good" | "bad") => {
          const build = await started.running.deployments.build({
            projectId: project.id,
            target: { targetId: target.id },
            spec: spec(version, mode, port),
            requestKey: `m4-4-build-${version}`,
            requestedBy: "e2e",
          });
          const artifact = started.running.deployments.artifactForBuild(build.id);
          if (!artifact) throw new Error("missing artifact");
          const plan = await started.running.app.inject({
            method: "POST",
            url: "/api/service-ops/plans",
            headers: auth,
            payload: { artifactId: artifact.id, requestKey: `m4-4-plan-${version}` },
          });
          expect(plan.statusCode).toBe(200);
          const planBody = plan.json() as { id: string };
          const authorization = await started.running.app.inject({
            method: "POST",
            url: "/api/service-ops/authorizations",
            headers: auth,
            payload: {
              planId: planBody.id,
              requestKey: `m4-4-auth-${version}`,
              sessionId: session.id,
            },
          });
          expect(authorization.statusCode).toBe(200);
          const authorizationBody = authorization.json() as {
            authorization: { id: string; status: string };
          };
          expect(authorizationBody.authorization.status).toBe("AUTHORIZED");
          const applied = await started.running.app.inject({
            method: "POST",
            url: "/api/service-ops/apply",
            headers: auth,
            payload: {
              planId: planBody.id,
              authorizationId: authorizationBody.authorization.id,
              consumeKey: `m4-4-apply-${version}`,
            },
          });
          expect(applied.statusCode).toBe(200);
          return applied.json() as { status: string; reasonCode: string | null; version: string };
        };

        const first = await applyVersion("v1", "good");
        expect(first.status).toBe("SUCCEEDED");
        const service = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${target.id}`,
          headers: { cookie: started.cookie },
        });
        expect(service.json()).toMatchObject({
          observedState: "running",
          version: "v1",
          desiredState: "running",
        });
        expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toContain("v1");

        const action = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/services/${target.id}/actions`,
          headers: auth,
          payload: { action: "restart", requestKey: "m4-4-restart", sessionId: session.id },
        });
        const actionBody = action.json() as { id: string; status: string };
        expect(actionBody.status).toBe("AUTHORIZED");
        const executed = await started.running.app.inject({
          method: "POST",
          url: `/api/service-ops/service-actions/${actionBody.id}/execute`,
          headers: auth,
          payload: { consumeKey: "m4-4-restart-exec" },
        });
        expect(executed.json()).toMatchObject({ observedState: "running", version: "v1" });

        const second = await applyVersion("v2", "good");
        expect(second.status).toBe("SUCCEEDED");
        expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toContain("v2");
        const failed = await applyVersion("v3", "bad");
        expect(failed.status).toBe("FAILED");
        expect(failed.reasonCode).toBe("HEALTH_FAILED_ROLLED_BACK");
        expect(await (await fetch(`http://127.0.0.1:${port}/health`)).text()).toContain("v2");

        const deployments = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${target.id}/deployments`,
          headers: { cookie: started.cookie },
        });
        expect((deployments.json() as { items: unknown[] }).items).toHaveLength(3);
        const logs = await started.running.app.inject({
          method: "GET",
          url: `/api/service-ops/services/${target.id}/logs`,
          headers: { cookie: started.cookie },
        });
        expect((logs.json() as { text: string }).text).toContain("ready v2");
        const events = await started.running.app.inject({
          method: "GET",
          url: `/api/resource-events?streamId=ops:${target.id}&after=0`,
          headers: { cookie: started.cookie },
        });
        expect((events.json() as { items: { type: string }[] }).items.length).toBeGreaterThan(2);
      } finally {
        if (started.running.pm2Global.status === "ready") {
          const adapter = new Pm2Adapter(started.running.pm2Global, started.running.dataDir);
          await adapter.close().catch(() => undefined);
        }
        await stopAuthorizedServer(started);
      }
    });
  }, 240_000);
});
