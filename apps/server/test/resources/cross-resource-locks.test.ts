import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer } from "../support/server.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}
async function repo(root: string) {
  await mkdir(root);
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.com");
  await writeFile(path.join(root, "a.txt"), "one\n");
  git(root, "add", "a.txt");
  git(root, "commit", "-q", "-m", "initial");
}

it("shares root locks across file and Git writers, allows disjoint roots, and fences stale handles", async () => {
  await withTempDir(async (dir) => {
    const rootA = path.join(dir, "repo-a");
    const rootB = path.join(dir, "repo-b");
    await repo(rootA);
    await repo(rootB);
    const started = await startAuthorizedServer(path.join(dir, "data"));
    try {
      const projectA = await createProject({ db: started.running.db }, { rootPath: rootA });
      const projectB = await createProject({ db: started.running.db }, { rootPath: rootB });
      const headers = {
        cookie: started.cookie,
        origin: started.origin,
        "x-csrf-token": started.csrf,
      };
      await writeFile(path.join(rootA, "a.txt"), "locked change\n");
      await writeFile(path.join(rootB, "a.txt"), "other change\n");
      const lock = new ProjectWriteLock({
        db: started.running.db,
        projectId: projectA.id,
        rootRealPath: projectA.realPath,
        owner: "manual",
        executionId: "manual-writer",
        ttlMs: 60_000,
      });
      expect(lock.acquire()).not.toBeNull();

      const actionB = await started.running.git.createAction(
        projectB.id,
        { action: "add", paths: ["a.txt"] },
        "fixture",
      );
      expect((await started.running.git.executeAction(actionB.id, "fixture")).status).toBe(
        "COMPLETED",
      );

      const actionA = await started.running.git.createAction(
        projectA.id,
        { action: "add", paths: ["a.txt"] },
        "fixture",
      );
      await expect(started.running.git.executeAction(actionA.id, "fixture")).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });

      const opened = (
        await started.running.app.inject({
          url: `/api/files?projectId=${projectA.id}&path=a.txt`,
          headers,
        })
      ).json();
      const saved = await started.running.app.inject({
        method: "PUT",
        url: "/api/files",
        headers,
        payload: {
          scope: { projectId: projectA.id },
          path: "a.txt",
          expectedVersion: opened.version,
          content: "must not write\n",
        },
      });
      expect(saved.json()).toMatchObject({ error: { code: "RESOURCE_LOCKED" } });
      expect(await readFile(path.join(rootA, "a.txt"), "utf8")).toBe("locked change\n");

      lock.release();
      expect(lock.renew()).toBeNull();
      expect(lock.release()).toBe(false);
      expect((await started.running.git.executeAction(actionA.id, "fixture")).status).toBe(
        "COMPLETED",
      );
      const next = new ProjectWriteLock({
        db: started.running.db,
        projectId: projectA.id,
        rootRealPath: projectA.realPath,
        owner: "next",
        executionId: "next-writer",
        ttlMs: 60_000,
      });
      expect(next.acquire()).not.toBeNull();
      next.release();
    } finally {
      await started.running.shutdown("test");
    }
  });
});
