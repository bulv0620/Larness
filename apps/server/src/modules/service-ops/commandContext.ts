import path from "node:path";
import { commandEnvironment } from "@larness/resources";
import type { Pm2CommandContext } from "@larness/shared";
import type { Database } from "../../db/client.js";
import { getProjectById, listProjects } from "../projects/repository.js";
import type { Pm2Global } from "./pm2.js";
import type { ServiceOpsRuntime } from "./serviceOps.js";

export function pm2CommandEnvironment(global: Pm2Global, dataDir: string) {
  return {
    pm2Home: path.join(dataDir, "pm2"),
    env: {
      ...commandEnvironment(),
      PATH:
        global.status === "ready"
          ? [path.dirname(global.entry), process.env.PATH].filter(Boolean).join(path.delimiter)
          : process.env.PATH,
    },
  };
}

export async function pm2CommandContext(
  db: Database,
  dataDir: string,
  global: Pm2Global,
  runtime: ServiceOpsRuntime,
  projectId: string | null,
): Promise<Pm2CommandContext> {
  await runtime.reconcile();
  const project = projectId ? getProjectById(db, projectId) : null;
  const projects = new Map(listProjects(db).map((item) => [item.id, item.name]));
  return {
    available: global.status === "ready",
    nodeExecutable: process.execPath,
    entry: global.status === "ready" ? global.entry : null,
    version: global.status === "ready" ? global.version : null,
    home: path.join(dataDir, "pm2"),
    namespace: "larness",
    serviceNamePattern: "larness:<projectId>:<serviceKey>",
    project: project
      ? {
          id: project.id,
          name: project.name,
          root: project.realPath,
          releaseRoot: path.join(dataDir, "releases", project.id),
        }
      : null,
    unassociatedServices: runtime.listUnassociatedServices(),
    services: runtime.listServices().map((service) => ({
      projectId: service.projectId,
      projectName: projects.get(service.projectId) ?? service.projectId,
      name: service.name,
      pm2Name: service.pm2Name,
      observedState: service.observedState,
      pid: service.pid,
      updatedAt: service.updatedAt,
    })),
  };
}
