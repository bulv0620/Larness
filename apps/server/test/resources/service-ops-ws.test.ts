import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DeploymentSpec } from "@larness/shared";
import { expect, it } from "vitest";
import WebSocket from "ws";
import { newId } from "../../src/db/ids.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, label: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${label}`);
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
    health: { path: "/health", port: 45124, timeoutMs: 1000, intervalMs: 100 },
    recovery: { strategy: "restart", maxAttempts: 1 },
  };
}

it("streams formal service status over an authorized service-ops subscription", async () => {
  await withTempDir(async (dir) => {
    const started = await startAuthorizedServer(path.join(dir, "data"));
    const root = path.join(dir, "project");
    await mkdir(root);
    await writeFile(
      path.join(root, "build.mjs"),
      'import { mkdir, writeFile } from "node:fs/promises"; await mkdir("dist",{recursive:true}); await writeFile("dist/main.js","console.log(1);");\n',
    );
    const socket = new WebSocket(`ws://127.0.0.1:${started.port}/ws`, {
      headers: { cookie: started.cookie, origin: started.origin },
    });
    const messages: Record<string, unknown>[] = [];
    socket.on("message", (raw) => messages.push(JSON.parse(raw.toString())));
    try {
      const project = await createProject(
        { db: started.running.db, detectGit: async () => false },
        { rootPath: root },
      );
      const target = started.running.deployments.ensureTarget({
        projectId: project.id,
        name: "web",
      });
      const build = await started.running.deployments.build({
        projectId: project.id,
        target: { targetId: target.id },
        spec: spec(),
        requestKey: newId("req"),
        requestedBy: "client-ws",
      });
      const artifact = started.running.deployments.artifactForBuild(build.id);
      if (!artifact) throw new Error("missing artifact");
      const plan = started.running.deployments.createPlan({
        artifactId: artifact.id,
        requestKey: newId("plan"),
        requestedBy: "client-ws",
      });
      const context = {
        domain: "service-ops" as const,
        projectId: project.id,
        targetId: target.id,
        action: "apply" as const,
        policy: "autonomous" as const,
        policySnapshotId: "psnap-ws",
        actor: { type: "human" as const, id: "client-ws" },
        clientSessionId: "client-ws",
        sessionId: null,
        turnId: null,
      };
      const authorization = await started.running.deploymentAuthorizations.authorizePlan({
        planId: plan.id,
        requestKey: newId("auth"),
        context,
      });
      await started.running.serviceOps.apply({
        planId: plan.id,
        authorizationId: authorization.authorization.id,
        consumeKey: newId("consume"),
        context,
      });

      await new Promise<void>((resolve, reject) => {
        if (socket.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      socket.send(
        JSON.stringify({
          type: "subscribe",
          subscriptions: [{ topic: "service-ops", resourceId: target.id, after: 0 }],
        }),
      );
      await waitFor(
        () => messages.some((message) => message.kind === "subscribed"),
        "service-ops subscription ack",
      );
      await started.running.serviceOps.reconcile();
      await waitFor(
        () => messages.some((message) => message.topic === "service-ops"),
        "service-ops event",
      );
      const event = messages.find((message) => message.topic === "service-ops");
      expect(event).toMatchObject({
        topic: "service-ops",
        resourceId: target.id,
        payload: { observedState: "unknown", reasonCode: "PM2_UNAVAILABLE" },
      });

      socket.send(
        JSON.stringify({
          type: "subscribe",
          subscriptions: [
            { topic: "service-ops", resourceId: `tgt_${crypto.randomUUID()}`, after: 0 },
          ],
        }),
      );
      await waitFor(
        () =>
          messages.some(
            (message) =>
              message.kind === "error" &&
              message.message === "invalid service operations subscription",
          ),
        "invalid target rejection",
      );
    } finally {
      socket.terminate();
      await stopAuthorizedServer(started);
    }
  });
});
