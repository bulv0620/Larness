import { execFileSync } from "node:child_process";
import { mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { GitManager } from "../../src/modules/git/manager.js";
import { getProjectById } from "../../src/modules/projects/repository.js";
import { createProject } from "../../src/modules/projects/service.js";
import { withTempDir } from "../helpers.js";
import {
  type AuthorizedServer,
  startAuthorizedServer,
  stopAuthorizedServer,
} from "../support/server.js";

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

it("uses literal paths for diff and staging when a filename contains a glob", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      await writeFile(path.join(f.repo, "a[1].txt"), "literal\n");
      await writeFile(path.join(f.repo, "a1.txt"), "pattern match\n");
      git(f.repo, "add", "--", ".");
      git(f.repo, "commit", "-qm", "glob filenames");
      await writeFile(path.join(f.repo, "a[1].txt"), "literal edited\n");
      await writeFile(path.join(f.repo, "a1.txt"), "pattern match edited\n");

      const diff = await manager.diff(f.projectId, "a[1].txt", false);
      const add = await manager.createAction(
        f.projectId,
        { action: "add", paths: ["a[1].txt"] },
        f.clientId,
      );
      await manager.executeAction(add.id, f.clientId);
      const status = await manager.status(f.projectId);
      expect(status.staged.map((item) => item.path)).toEqual(["a[1].txt"]);
      expect(status.unstaged.map((item) => item.path)).toEqual(["a1.txt"]);
      expect(diff.diff).toContain("+literal edited");
      expect(diff.diff).not.toContain("+pattern match edited");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("does not create a local branch when switching to a remote-only name", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      git(f.repo, "push", "-q", "origin", "HEAD:refs/heads/remote-only");
      git(f.repo, "fetch", "-q", "origin");
      const action = await manager.createAction(
        f.projectId,
        { action: "switchBranch", name: "remote-only" },
        f.clientId,
      );
      await expect(manager.executeAction(action.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(git(f.repo, "branch", "--show-current")).toBe("main");
      expect(git(f.repo, "branch", "--list", "remote-only")).toBe("");
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("rejects a non-fast-forward push even with a forced default refspec", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      const initial = git(f.repo, "rev-parse", "HEAD");
      await writeFile(path.join(f.repo, "a.txt"), "remote head\n");
      git(f.repo, "commit", "-qam", "advance upstream");
      git(f.repo, "push", "-q");
      const upstream = git(f.remote, "rev-parse", "main");
      git(f.repo, "update-ref", "refs/heads/main", initial);
      git(f.repo, "config", "remote.origin.push", "+refs/heads/main:refs/heads/main");

      const push = await manager.createAction(f.projectId, { action: "push" }, f.clientId);
      manager.decideAction(push.id, "approve", f.clientId);
      await expect(manager.executeAction(push.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(git(f.remote, "rev-parse", "main")).toBe(upstream);
    } finally {
      await f.started.running.shutdown("test");
    }
  });
});

it("pushes only the configured upstream branch, ignoring push remotes, refspecs and tags", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    try {
      const manager = f.started.running.git;
      git(f.repo, "push", "-qu", "origin", "HEAD:refs/heads/target");
      const initial = git(f.remote, "rev-parse", "main");
      const other = path.join(dir, "other.git");
      git(dir, "init", "-q", "--bare", other);
      git(f.repo, "remote", "add", "other", other);
      git(f.repo, "config", "branch.main.pushRemote", "other");
      for (const remote of ["origin", "other"])
        git(f.repo, "config", `remote.${remote}.push`, "refs/heads/main:refs/heads/unrelated");
      git(f.repo, "config", "remote.origin.mirror", "true");
      await writeFile(path.join(f.repo, "a.txt"), "ahead\n");
      git(f.repo, "commit", "-qam", "advance upstream only");
      git(f.repo, "tag", "-am", "tag", "v1");
      git(f.repo, "config", "push.followTags", "true");

      const push = await manager.createAction(f.projectId, { action: "push" }, f.clientId);
      manager.decideAction(push.id, "approve", f.clientId);
      expect((await manager.executeAction(push.id, f.clientId)).status).toBe("COMPLETED");
      expect(git(f.remote, "rev-parse", "target")).toBe(git(f.repo, "rev-parse", "HEAD"));
      expect(git(f.remote, "rev-parse", "main")).toBe(initial);
      expect(git(f.remote, "for-each-ref", "--format=%(refname)")).toBe(
        "refs/heads/main\nrefs/heads/target",
      );
      expect(git(other, "for-each-ref")).toBe("");
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

it("unstages without losing worktree changes and discards only unstaged content", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    const manager = f.started.running.git;
    const run = async (input: unknown) => {
      const prepared = await manager.createAction(f.projectId, input, f.clientId);
      return manager.executeAction(prepared.id, f.clientId);
    };
    try {
      await writeFile(path.join(f.repo, "a.txt"), "staged\n");
      git(f.repo, "add", "--", "a.txt");
      await writeFile(path.join(f.repo, "a.txt"), "unstaged\n");
      expect((await run({ action: "discard", path: "a.txt", confirmed: true })).status).toBe(
        "COMPLETED",
      );
      expect(await readFile(path.join(f.repo, "a.txt"), "utf8")).toBe("staged\n");
      expect(git(f.repo, "show", ":a.txt")).toBe("staged");
      expect((await run({ action: "unstage", paths: ["a.txt"] })).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.repo, "a.txt"), "utf8")).toBe("staged\n");
      expect(git(f.repo, "diff", "--cached")).toBe("");
      await writeFile(path.join(f.repo, "new.txt"), "keep");
      git(f.repo, "add", "new.txt");
      await run({ action: "unstage", paths: ["new.txt"] });
      expect(await readFile(path.join(f.repo, "new.txt"), "utf8")).toBe("keep");
      expect((await run({ action: "discard", path: "new.txt", confirmed: true })).status).toBe(
        "COMPLETED",
      );
      await expect(readFile(path.join(f.repo, "new.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("rejects unconfirmed or stale discard and treats wildcard paths literally", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir);
    const manager = f.started.running.git;
    try {
      await writeFile(path.join(f.repo, "a.txt"), "changed\n");
      await expect(
        Promise.resolve().then(() =>
          manager.createAction(f.projectId, { action: "discard", path: "a.txt" }, f.clientId),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      const action = await manager.createAction(
        f.projectId,
        { action: "discard", path: "a.txt", confirmed: true },
        f.clientId,
      );
      await writeFile(path.join(f.repo, "a.txt"), "newer edits\n");
      await expect(manager.executeAction(action.id, f.clientId)).rejects.toMatchObject({
        code: "GIT_CONFLICT",
      });
      expect(await readFile(path.join(f.repo, "a.txt"), "utf8")).toBe("newer edits\n");
      for (const name of ["*.txt", "keep.txt"]) await writeFile(path.join(f.repo, name), "keep");
      const remove = await manager.createAction(
        f.projectId,
        { action: "discard", path: "*.txt", confirmed: true },
        f.clientId,
      );
      expect((await manager.executeAction(remove.id, f.clientId)).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.repo, "keep.txt"), "utf8")).toBe("keep");
      expect((await manager.executeAction(remove.id, f.clientId)).status).toBe("COMPLETED");
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("handles unborn index, renames and deleted files without changing retained worktree data", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir),
      manager = f.started.running.git;
    const run = async (input: unknown) =>
      manager.executeAction(
        (await manager.createAction(f.projectId, input, f.clientId)).id,
        f.clientId,
      );
    try {
      git(f.repo, "mv", "a.txt", "renamed.txt");
      expect((await run({ action: "unstage", paths: ["renamed.txt"] })).status).toBe("COMPLETED");
      expect(git(f.repo, "diff", "--cached")).toBe("");
      expect(await readFile(path.join(f.repo, "renamed.txt"), "utf8")).toBe("one\n");
      await unlink(path.join(f.repo, "b.txt"));
      expect((await run({ action: "discard", path: "b.txt", confirmed: true })).status).toBe(
        "COMPLETED",
      );
      expect(await readFile(path.join(f.repo, "b.txt"), "utf8")).toBe("two\n");
      git(f.repo, "switch", "--orphan", "unborn");
      await writeFile(path.join(f.repo, "first.txt"), "new content");
      git(f.repo, "add", "first.txt");
      expect((await run({ action: "unstage", paths: ["first.txt"] })).status).toBe("COMPLETED");
      expect(await readFile(path.join(f.repo, "first.txt"), "utf8")).toBe("new content");
      expect((await manager.status(f.projectId)).staged).toEqual([]);
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});

it("rejects discard of symlinks, directories and traversal and requires API authentication", async () => {
  await withTempDir(async (dir) => {
    const f = await repoFixture(dir),
      manager = f.started.running.git;
    try {
      const outside = path.join(dir, "outside.txt");
      await writeFile(outside, "keep outside");
      await symlink(outside, path.join(f.repo, "link"));
      await mkdir(path.join(f.repo, "folder"));
      await writeFile(path.join(f.repo, "folder", "file.txt"), "keep nested");
      for (const value of ["link", "folder", "../outside.txt"])
        await expect(
          manager.createAction(
            f.projectId,
            { action: "discard", path: value, confirmed: true },
            f.clientId,
          ),
        ).rejects.toMatchObject({ code: "GIT_CONFLICT" });
      expect(await readFile(outside, "utf8")).toBe("keep outside");
      const response = await f.started.running.app.inject({
        method: "POST",
        url: `/api/projects/${f.projectId}/git/actions`,
        headers: { origin: f.started.origin },
        payload: { action: "discard", path: "folder/file.txt", confirmed: true },
      });
      expect(response.statusCode).toBe(401);
      const action = await manager.createAction(
        f.projectId,
        { action: "discard", path: "folder/file.txt", confirmed: true },
        f.clientId,
      );
      expect((await manager.executeAction(action.id, f.clientId)).status).toBe("COMPLETED");
      await expect(readFile(path.join(f.repo, "folder", "file.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await stopAuthorizedServer(f.started);
    }
  });
});
