import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("memory API", () => {
  it("creates, lists, edits and forgets a project memory", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);
      try {
        const projectDir = path.join(dir, "project");
        await mkdir(projectDir);
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const project = (
          await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { name: "Demo", rootPath: projectDir },
          })
        ).json() as { id: string };

        const created = await started.running.app.inject({
          method: "POST",
          url: `/api/projects/${project.id}/memories`,
          headers,
          payload: {
            kind: "fact",
            key: "build.test.command",
            title: "Test command",
            body: "pnpm test",
          },
        });
        expect(created.statusCode).toBe(201);
        const memory = created.json() as { id: string; status: string; updatedAt: number };
        expect(memory.status).toBe("active");

        const list = await started.running.app.inject({
          method: "GET",
          url: `/api/projects/${project.id}/memories`,
          headers: { cookie: started.cookie },
        });
        expect(list.statusCode).toBe(200);
        expect(list.json()).toMatchObject({
          items: [expect.objectContaining({ key: "build.test.command", revisionCount: 1 })],
          budget: { activeCount: 1 },
        });

        const updated = await started.running.app.inject({
          method: "PATCH",
          url: `/api/projects/${project.id}/memories/${memory.id}`,
          headers,
          payload: { body: "pnpm test:unit", expectedUpdatedAt: memory.updatedAt },
        });
        expect(updated.statusCode).toBe(200);
        const edited = updated.json() as { updatedAt: number; revisionCount: number };
        expect(edited.revisionCount).toBe(2);

        const stale = await started.running.app.inject({
          method: "PATCH",
          url: `/api/projects/${project.id}/memories/${memory.id}`,
          headers,
          payload: { body: "pnpm test:e2e", expectedUpdatedAt: memory.updatedAt },
        });
        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });

        const deleted = await started.running.app.inject({
          method: "DELETE",
          url: `/api/projects/${project.id}/memories/${memory.id}?expectedUpdatedAt=${edited.updatedAt}`,
          headers,
        });
        expect(deleted.statusCode).toBe(200);

        const relearn = await started.running.app.inject({
          method: "POST",
          url: `/api/projects/${project.id}/memories`,
          headers,
          payload: {
            kind: "fact",
            key: "build.test.command",
            title: "Test command",
            body: "pnpm test",
          },
        });
        expect(relearn.statusCode).toBe(409);
        expect(relearn.json()).toMatchObject({ error: { code: "MEMORY_SUPPRESSED" } });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("keeps project memories isolated and exposes global preferences", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);
      try {
        const headers = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const roots = [path.join(dir, "a"), path.join(dir, "b")];
        const projects: string[] = [];

        for (const root of roots) {
          await mkdir(root);
          const created = await started.running.app.inject({
            method: "POST",
            url: "/api/projects",
            headers,
            payload: { rootPath: root },
          });
          projects.push((created.json() as { id: string }).id);
        }

        await started.running.app.inject({
          method: "POST",
          url: `/api/projects/${projects[0]}/memories`,
          headers,
          payload: {
            kind: "fact",
            key: "project.only",
            title: "Only A",
            body: "A fact",
          },
        });
        await started.running.app.inject({
          method: "POST",
          url: "/api/memories/global",
          headers,
          payload: {
            kind: "preference",
            key: "workflow.package-manager",
            title: "Package manager",
            body: "以后都用 pnpm",
          },
        });

        const b = await started.running.app.inject({
          method: "GET",
          url: `/api/projects/${projects[1]}/memories`,
          headers: { cookie: started.cookie },
        });
        expect(b.json().items).toEqual([]);

        const global = await started.running.app.inject({
          method: "GET",
          url: "/api/memories/global",
          headers: { cookie: started.cookie },
        });
        expect(global.json()).toMatchObject({
          items: [expect.objectContaining({ key: "workflow.package-manager" })],
        });

        const defaultProject = await started.running.app.inject({
          method: "GET",
          url: "/api/projects/prj_default/memories",
          headers: { cookie: started.cookie },
        });
        expect(defaultProject.statusCode).toBe(403);
        expect(defaultProject.json()).toMatchObject({
          error: { code: "MEMORY_SCOPE_FORBIDDEN" },
        });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("requires authentication and CSRF", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir);
      try {
        const unauth = await started.running.app.inject({
          method: "GET",
          url: "/api/memories/global",
        });
        expect(unauth.statusCode).toBe(401);

        const noCsrf = await started.running.app.inject({
          method: "POST",
          url: "/api/memories/global",
          headers: { cookie: started.cookie, origin: started.origin },
          payload: {
            kind: "preference",
            key: "workflow.test",
            title: "Test",
            body: "test",
          },
        });
        expect(noCsrf.statusCode).toBe(403);
        expect(noCsrf.json()).toMatchObject({ error: { code: "CSRF_INVALID" } });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
