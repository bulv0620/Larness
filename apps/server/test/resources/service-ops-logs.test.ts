import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createProject } from "../../src/modules/projects/service.js";
import { ResourceEventBus } from "../../src/modules/resources/events.js";
import { DeploymentAuthorizationService } from "../../src/modules/service-ops/authorization.js";
import { DeploymentManager } from "../../src/modules/service-ops/deployments.js";
import { Pm2Adapter, type Pm2Process } from "../../src/modules/service-ops/pm2.js";
import { ServiceOpsRuntime } from "../../src/modules/service-ops/serviceOps.js";
import { withTempDir } from "../helpers.js";

it("reads only the registered service's own project log, rejecting links, foreign paths and unknown identity", async () => {
  await withTempDir(async (dir) => {
    const dataDir = path.join(dir, "data");
    const root = path.join(dir, "project");
    const other = path.join(dir, "other");
    await Promise.all([mkdir(dataDir), mkdir(root), mkdir(other)]);
    const opened = openDatabase(path.join(dataDir, "larness.db"));
    runMigrations(opened.db);
    try {
      const project = await createProject(
        { db: opened.db, detectGit: async () => false },
        { rootPath: root },
      );
      const log = path.join(root, "out.log");
      await writeFile(log, "ready secret-marker");
      const app: Pm2Process = {
        id: 0,
        pid: 1234,
        status: "online",
        name: `larness:${project.id}:api`,
        namespace: "larness",
        entry: path.join(root, "server.js"),
        cwd: root,
        log,
        interpreter: process.execPath,
      };
      const pm2 = new Pm2Adapter(
        { status: "ready", entry: process.execPath, version: "7.1.2", root: dir, installed: false },
        dataDir,
      );
      const list = vi.spyOn(pm2, "list").mockResolvedValue([app]);
      const find = vi.spyOn(pm2, "find").mockImplementation(async () => app);
      const deployments = new DeploymentManager({ db: opened.db, dataDir });
      const runtime = new ServiceOpsRuntime({
        db: opened.db,
        dataDir,
        deployments,
        authorizations: new DeploymentAuthorizationService({ db: opened.db, deployments }),
        pm2,
        events: new ResourceEventBus(),
        secrets: () => ["secret-marker"],
      });
      await runtime.reconcile();
      const service = runtime.listServices()[0];
      if (!service) throw new Error("missing service");
      expect((await runtime.logs(service.targetId)).text).toContain("ready");
      expect((await runtime.logs(service.targetId)).text).not.toContain("secret-marker");
      app.log = path.join(other, "out.log");
      await writeFile(app.log, "foreign");
      await expect(runtime.logs(service.targetId)).rejects.toMatchObject({
        code: "DEPLOY_UNAVAILABLE",
      });
      if (process.platform !== "win32") {
        app.log = path.join(root, "linked.log");
        await symlink(log, app.log);
        await expect(runtime.logs(service.targetId)).rejects.toMatchObject({
          code: "DEPLOY_UNAVAILABLE",
        });
      }
      app.log = log;
      app.namespace = "foreign";
      await expect(runtime.logs(service.targetId)).rejects.toMatchObject({
        code: "DEPLOY_UNAVAILABLE",
      });
      app.namespace = "larness";
      find.mockResolvedValue("unknown");
      await expect(runtime.logs(service.targetId)).rejects.toMatchObject({
        code: "DEPLOY_UNAVAILABLE",
      });
      list.mockResolvedValue("unknown");
      await runtime.reconcile();
      expect(runtime.listServices()).toHaveLength(1);
      list.mockResolvedValue([]);
      await runtime.reconcile();
      expect(runtime.listServices()).toHaveLength(0);
      expect(runtime.getService(service.targetId).targetId).toBe(service.targetId);
      list.mockResolvedValue("unknown");
      await runtime.reconcile();
      expect(runtime.listServices()).toHaveLength(0);
      list.mockResolvedValue([app]);
      await runtime.reconcile();
      expect(runtime.listServices()[0]?.targetId).toBe(service.targetId);
    } finally {
      opened.sqlite.close();
      vi.restoreAllMocks();
    }
  });
});
