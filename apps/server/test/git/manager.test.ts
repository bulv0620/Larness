import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { GitManager } from "../../src/modules/git/manager.js";
import { getProjectById } from "../../src/modules/projects/repository.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";
import { type AuthorizedServer, startAuthorizedServer } from "../support/server.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

interface RepoFixture {
  started: AuthorizedServer;
  repo: string;
  remote: string;
  projectId: string;
  clientId: string;
}

async function repoFixture(dir: string): Promise<RepoFixture> {
  const repo = path.join(dir, "repo");
  const remote = path.join(dir, "remote.git");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.com");
  await writeFile(path.join(repo, "a.txt"), "one\n");
  await writeFile(path.join(repo, "b.txt"), "two\n");
  git(repo, "add", "a.txt", "b.txt");
  git(repo, "commit", "-q", "-m", "initial");
  git(dir, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  const started = await startAuthorizedServer(path.join(dir, "data"));
  const project = await createProject({ db: started.running.db }, { rootPath: repo });
  const client = (
    await started.running.app.inject({
      url: "/api/auth/session",
      headers: { cookie: started.cookie },
    })
  ).json() as { clientSessionId: string };
  return { started, repo, remote, projectId: project.id, clientId: client.clientSessionId };
}

it("reads structured status, diffs, log and branches with a stable snapshot", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      const initial = await manager.status(f.projectId);
      expect(initial.branch).toBe("main");
      expect(initial.head).toBeTruthy();
      expect(initial.untracked).toEqual([]);
      await writeFile(path.join(f.repo, "a.txt"), "changed\n");
      await writeFile(path.join(f.repo, "new file.txt"), "new\n");
      const status = await manager.status(f.projectId);
      expect(status.unstaged).toEqual([{ path: "a.txt", origPath: null, status: "modified" }]);
      expect(status.untracked).toEqual(["new file.txt"]);
      expect(status.snapshotVersion).not.toBe(initial.snapshotVersion);

      const diff = await manager.diff(f.projectId, "a.txt", false);
      expect(diff.diff).toContain("-one");
      expect(diff.diff).toContain("+changed");
      expect(diff.binary).toBe(false);
      expect(diff.truncated).toBe(false);

      const log = await manager.log(f.projectId, 10, 0);
      expect(log[0]?.subject).toBe("initial");
      const branches = await manager.branches(f.projectId, 10, 0);
      expect(branches).toEqual([{ name: "main", current: true, head: initial.head }]);

      const unauthenticated = await f.started.running.app.inject({
        url: `/api/projects/${f.projectId}/git/status`,
        headers: { origin: f.started.origin },
      });
      expect(unauthenticated.statusCode).toBe(401);
      const headers = {
        cookie: f.started.cookie,
        origin: f.started.origin,
        "x-csrf-token": f.started.csrf,
      };
      const remoteStatus = await f.started.running.app.inject({
        url: `/api/projects/${f.projectId}/git/status`,
        headers,
      });
      expect(remoteStatus.statusCode).toBe(200);
      expect(remoteStatus.json()).toMatchObject({ branch: "main" });
      const noCsrf = await f.started.running.app.inject({
        method: "POST",
        url: `/api/projects/${f.projectId}/git/actions`,
        headers: { cookie: f.started.cookie, origin: f.started.origin },
        payload: { action: "add", paths: ["a.txt"] },
      });
      expect(noCsrf.statusCode).toBe(403);
      const created = await f.started.running.app.inject({
        method: "POST",
        url: `/api/projects/${f.projectId}/git/actions`,
        headers,
        payload: { action: "add", paths: ["a.txt"] },
      });
      expect(created.statusCode).toBe(201);
      const executed = await f.started.running.app.inject({
        method: "POST",
        url: `/api/resource-actions/${created.json().id as string}/execute`,
        headers,
        payload: {},
      });
      expect(executed.statusCode).toBe(200);
      expect(executed.json()).toMatchObject({ status: "COMPLETED" });
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("stages only explicit paths, commits staged content, and handles special filenames", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      await writeFile(path.join(f.repo, "a.txt"), "staged\n");
      await writeFile(path.join(f.repo, "b.txt"), "unstaged\n");
      await writeFile(path.join(f.repo, "space name.txt"), "space\n");
      const add = manager.createAction(
        f.projectId,
        { action: "add", paths: ["a.txt", "space name.txt"] },
        f.clientId,
      );
      const created = await add;
      expect(created.status).toBe("PREPARED");
      await manager.executeAction(created.id, f.clientId);
      const status = await manager.status(f.projectId);
      expect(status.staged.map((item) => item.path).sort()).toEqual(["a.txt", "space name.txt"]);
      expect(status.unstaged.map((item) => item.path)).toEqual(["b.txt"]);

      const commit = await manager.createAction(
        f.projectId,
        { action: "commit", message: "selected only" },
        f.clientId,
      );
      const done = await manager.executeAction(commit.id, f.clientId);
      expect(done.status).toBe("COMPLETED");
      expect(git(f.repo, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt\nspace name.txt");
      const log = await manager.log(f.projectId, 5, 0);
      expect(log[0]?.subject).toBe("selected only");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("binds L2 push approval, consumes it once, and rejects snapshot changes or expiry", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      await writeFile(path.join(f.repo, "a.txt"), "push me\n");
      await git(f.repo, "commit", "-q", "-am", "push me");
      const push = await manager.createAction(f.projectId, { action: "push" }, f.clientId);
      expect(push.status).toBe("WAITING_APPROVAL");
      await expect(manager.executeAction(push.id, f.clientId)).rejects.toMatchObject({
        code: "APPROVAL_INVALID",
      });
      const approved = manager.decideAction(push.id, "approve", f.clientId);
      expect(approved.status).toBe("APPROVED");
      const completed = await manager.executeAction(push.id, f.clientId);
      expect(completed.status).toBe("COMPLETED");
      expect(git(f.remote, "rev-parse", "main")).toBe(git(f.repo, "rev-parse", "HEAD"));
      const again = await manager.executeAction(push.id, f.clientId);
      expect(again.status).toBe("COMPLETED");

      const second = await manager.createAction(f.projectId, { action: "push" }, f.clientId);
      manager.decideAction(second.id, "approve", f.clientId);
      await writeFile(path.join(f.repo, "a.txt"), "after approval\n");
      await git(f.repo, "commit", "-q", "-am", "after approval");
      await expect(manager.executeAction(second.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(manager.action(second.id).status).toBe("FAILED");

      let now = 1_000_000;
      const clocked = new GitManager({ db: f.started.running.db, now: () => now });
      const expiring = await clocked.createAction(f.projectId, { action: "push" }, f.clientId);
      clocked.decideAction(expiring.id, "approve", f.clientId);
      now += 5 * 60_000;
      await expect(clocked.executeAction(expiring.id, f.clientId)).rejects.toMatchObject({
        code: "APPROVAL_INVALID",
      });
      expect(clocked.action(expiring.id).status).toBe("EXPIRED");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("pulls ff-only, refuses non-fast-forward and dirty branch switches without stashing", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      const clone = path.join(dir, "clone");
      git(dir, "clone", "-q", "-b", "main", f.remote, clone);
      git(clone, "config", "user.name", "Other");
      git(clone, "config", "user.email", "other@example.com");
      await writeFile(path.join(clone, "remote.txt"), "remote\n");
      git(clone, "add", "remote.txt");
      git(clone, "commit", "-q", "-m", "remote change");
      git(clone, "push", "-q", "origin", "main");

      const pull = await manager.createAction(f.projectId, { action: "pull" }, f.clientId);
      manager.decideAction(pull.id, "approve", f.clientId);
      expect((await manager.executeAction(pull.id, f.clientId)).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.repo, "remote.txt"), "utf8")).toBe("remote\n");

      await writeFile(path.join(f.repo, "local.txt"), "local\n");
      git(f.repo, "add", "local.txt");
      git(f.repo, "commit", "-q", "-m", "local change");
      await writeFile(path.join(clone, "remote2.txt"), "remote2\n");
      git(clone, "add", "remote2.txt");
      git(clone, "commit", "-q", "-m", "diverging change");
      git(clone, "push", "-q", "origin", "main");
      const divergence = await manager.createAction(f.projectId, { action: "pull" }, f.clientId);
      manager.decideAction(divergence.id, "approve", f.clientId);
      await expect(manager.executeAction(divergence.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(await readFile(path.join(f.repo, "local.txt"), "utf8")).toBe("local\n");
      expect(git(f.repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");

      await writeFile(path.join(f.repo, "a.txt"), "dirty\n");
      const switched = await manager.createAction(
        f.projectId,
        { action: "switchBranch", name: "main" },
        f.clientId,
      );
      await expect(manager.executeAction(switched.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(await readFile(path.join(f.repo, "a.txt"), "utf8")).toBe("dirty\n");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("does not run configured external diff helpers or textconv for read diffs", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const marker = path.join(dir, "external-diff-ran");
      const script = path.join(dir, "diff-helper.sh");
      await writeFile(script, `#!/bin/sh\necho ran > "${marker}"\nexit 0\n`, { mode: 0o755 });
      git(f.repo, "config", "diff.external", script);
      await writeFile(path.join(f.repo, "a.txt"), "external check\n");
      const diff = await f.started.running.git.diff(f.projectId, "a.txt", false);
      expect(diff.diff).toContain("+external check");
      await expect(readFile(marker, "utf8")).rejects.toThrow();
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("refuses an action while another project writer holds the lock and allows a retry after release", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const project = getProjectById(f.started.running.db, f.projectId);
      if (!project) throw new Error("Missing project");
      const lock = new ProjectWriteLock({
        db: f.started.running.db,
        projectId: f.projectId,
        rootRealPath: project.realPath,
        owner: "other-writer",
        executionId: "other-writer",
        ttlMs: 60_000,
      });
      expect(lock.acquire()).not.toBeNull();
      await writeFile(path.join(f.repo, "a.txt"), "locked\n");
      const action = await f.started.running.git.createAction(
        f.projectId,
        { action: "add", paths: ["a.txt"] },
        f.clientId,
      );
      await expect(
        f.started.running.git.executeAction(action.id, f.clientId),
      ).rejects.toMatchObject({ code: "GIT_CONFLICT" });
      expect(f.started.running.git.action(action.id).status).toBe("PREPARED");
      lock.release();
      expect((await f.started.running.git.executeAction(action.id, f.clientId)).status).toBe(
        "COMPLETED",
      );
      expect(
        (await f.started.running.git.status(f.projectId)).staged.map((item) => item.path),
      ).toEqual(["a.txt"]);
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("fails closed with GIT_UNAVAILABLE when Git cannot be executed", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      vi.stubEnv("PATH", "");
      await expect(f.started.running.git.status(f.projectId)).rejects.toMatchObject({
        code: "GIT_UNAVAILABLE",
      });
      vi.unstubAllEnvs();
    } finally {
      vi.unstubAllEnvs();
      await f.started.running.shutdown("test");
    }
  });
});
