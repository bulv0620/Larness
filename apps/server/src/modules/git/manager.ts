import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  GitError,
  parseBranches,
  parseLog,
  parseStatus,
  runGit,
  snapshotOf,
  validateGitPath,
} from "@larness/resources";
import {
  type GitAction,
  GitActionSchema,
  type GitActionView,
  type GitBranchView,
  type GitDiffView,
  type GitLogView,
  type GitStatusView,
} from "@larness/shared";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { appendAudit } from "../../db/repositories/audit.js";
import { type ResourceActionRow, resourceActions } from "../../db/schema.js";
import { immediateTransaction } from "../../db/transaction.js";
import { ProjectWriteLock } from "../agent/projectWriteLock.js";
import { getProjectById } from "../projects/repository.js";
import { insertOperation, updateOperation } from "../resources/repository.js";

const ACTION_TTL_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 120_000;

export interface GitManagerOptions {
  db: Database;
  now?: () => number;
  lockTtlMs?: number;
}
export interface AgentGitContext {
  turnId: string;
  toolCallId: string;
  assertAuthorized: () => void;
  signal?: AbortSignal;
}

function fail(
  code: "NOT_FOUND" | "FORBIDDEN" | "APPROVAL_INVALID" | "RESOURCE_LOCKED",
  message: string,
): never {
  throw Object.assign(new Error(message), { code });
}

export class GitManager {
  constructor(readonly options: GitManagerOptions) {}
  #now() {
    return this.options.now?.() ?? Date.now();
  }
  #project(projectId: string) {
    const project = getProjectById(this.options.db, projectId);
    if (!project) fail("NOT_FOUND", "Project not found");
    return project;
  }
  async available() {
    try {
      await runGit(process.cwd(), ["--version"], { readOnly: true, timeoutMs: 5_000 });
      return true;
    } catch {
      return false;
    }
  }
  async status(projectId: string): Promise<GitStatusView> {
    const project = this.#project(projectId);
    const { stdout } = await runGit(
      project.realPath,
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
    );
    const data = parseStatus(stdout);
    return {
      branch: data.branch,
      head: data.head,
      upstream: data.upstream,
      ahead: data.ahead,
      behind: data.behind,
      staged: data.staged.map(({ path, origPath, status }) => ({ path, origPath, status })),
      unstaged: data.unstaged.map(({ path, origPath, status }) => ({ path, origPath, status })),
      untracked: data.untracked,
      conflicts: data.conflicts.map(({ path, origPath, status }) => ({ path, origPath, status })),
      snapshotVersion: snapshotOf(data, stdout),
    };
  }
  async diff(projectId: string, value: string, staged: boolean): Promise<GitDiffView> {
    const project = this.#project(projectId);
    const path = validateGitPath(project.realPath, value);
    const numstat = await runGit(
      project.realPath,
      ["--literal-pathspecs", "diff", "--numstat", ...(staged ? ["--cached"] : []), "--", path],
      { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
    );
    const binary = numstat.stdout.split("\n").some((line) => line.startsWith("-\t-\t"));
    try {
      const result = await runGit(
        project.realPath,
        [
          "--literal-pathspecs",
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          ...(staged ? ["--cached"] : []),
          "--",
          path,
        ],
        { readOnly: true, timeoutMs: READ_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
      return { path, staged, diff: result.stdout, binary, truncated: false };
    } catch (error) {
      if (error instanceof GitError && error.code === "PAYLOAD_TOO_LARGE")
        return { path, staged, diff: "", binary, truncated: true };
      throw error;
    }
  }
  async log(projectId: string, limit: number, cursor: number): Promise<GitLogView[]> {
    const project = this.#project(projectId);
    const { stdout } = await runGit(
      project.realPath,
      [
        "log",
        `--max-count=${limit}`,
        `--skip=${cursor}`,
        "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e",
      ],
      { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
    );
    return parseLog(stdout);
  }
  async branches(projectId: string, limit: number, cursor: number): Promise<GitBranchView[]> {
    const project = this.#project(projectId);
    const { stdout } = await runGit(
      project.realPath,
      [
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname:short)\t%(objectname)\t%(HEAD)",
        "refs/heads",
      ],
      { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
    );
    return parseBranches(stdout).slice(cursor, cursor + limit);
  }
  action(id: string) {
    return this.#view(this.#row(id));
  }
  createAction(projectId: string, input: unknown, requestedBy: string) {
    const action = GitActionSchema.safeParse(input);
    if (!action.success) fail("FORBIDDEN", "Invalid Git action");
    const project = this.#project(projectId);
    const payload = action.data;
    return this.#actionSnapshot(projectId, payload).then((snapshot) => {
      const now = this.#now();
      const risk = payload.action === "pull" || payload.action === "push" ? "L2" : "L1";
      const id = newId("act");
      const operationId = newId("rop");
      const paramsJson = JSON.stringify(payload);
      const paramsHash = createHash("sha256").update(paramsJson).digest("hex");
      const status = risk === "L2" ? "WAITING_APPROVAL" : "PREPARED";
      immediateTransaction(this.options.db, (tx) => {
        insertOperation(tx, {
          id: operationId,
          scopeKey: `project:${project.id}`,
          rootRealPath: project.realPath,
          kind: "git.action",
          status: "COMPLETED",
          paramsHash,
          idempotencyKey: id,
          clientSessionId: requestedBy,
          path: "",
          expectedVersion: "",
          targetVersion: "",
          lockId: "",
          fencingToken: 0,
          resultJson: JSON.stringify({ actionId: id }),
          errorCode: null,
          createdAt: now,
          updatedAt: now,
        });
        tx.insert(resourceActions)
          .values({
            id,
            operationId,
            projectId: project.id,
            kind: payload.action,
            risk,
            status,
            paramsJson,
            paramsHash,
            snapshotHash: snapshot.snapshotVersion,
            requestedBy,
            decidedBy: null,
            expiresAt: now + ACTION_TTL_MS,
            decidedAt: null,
            startedAt: null,
            endedAt: null,
            resultJson: null,
            createdAt: now,
          })
          .run();
        appendAudit(tx, {
          action: "git.action.created",
          decision: "info",
          clientSessionId: requestedBy,
          resourceType: "git",
          resourceId: id,
          details: { projectId: project.id, kind: payload.action, risk },
          now,
        });
      });
      return this.#view(this.#row(id));
    });
  }
  decideAction(id: string, decision: "approve" | "reject", decidedBy: string) {
    const row = immediateTransaction(this.options.db, (tx) => {
      const current = tx.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
      if (!current) fail("NOT_FOUND", "Git action not found");
      if (current.status !== "WAITING_APPROVAL")
        fail("APPROVAL_INVALID", "Git action is not pending");
      if (current.expiresAt <= this.#now()) {
        tx.update(resourceActions)
          .set({ status: "EXPIRED", endedAt: this.#now() })
          .where(eq(resourceActions.id, id))
          .run();
        return tx
          .select()
          .from(resourceActions)
          .where(eq(resourceActions.id, id))
          .get() as ResourceActionRow;
      }
      const status = decision === "approve" ? "APPROVED" : "REJECTED";
      tx.update(resourceActions)
        .set({
          status,
          decidedBy,
          decidedAt: this.#now(),
          endedAt: decision === "reject" ? this.#now() : null,
        })
        .where(eq(resourceActions.id, id))
        .run();
      if (decision === "reject")
        updateOperation(tx, current.operationId, {
          status: "FAILED",
          errorCode: "REJECTED",
          updatedAt: this.#now(),
        });
      appendAudit(tx, {
        action: decision === "approve" ? "git.action.approved" : "git.action.rejected",
        decision: decision === "approve" ? "allow" : "deny",
        clientSessionId: decidedBy,
        resourceType: "git",
        resourceId: id,
        details: { kind: current.kind, risk: current.risk },
        now: this.#now(),
      });
      return tx
        .select()
        .from(resourceActions)
        .where(eq(resourceActions.id, id))
        .get() as ResourceActionRow;
    });
    if (row.status === "EXPIRED") fail("APPROVAL_INVALID", "Git action expired");
    return this.#view(row);
  }
  async executeAction(id: string, client: string) {
    const action = this.#row(id);
    if (["COMPLETED", "FAILED", "REJECTED", "EXPIRED", "INTERRUPTED"].includes(action.status))
      return this.#view(action);
    const executable =
      action.risk === "L1" ? action.status === "PREPARED" : action.status === "APPROVED";
    if (!executable) fail("APPROVAL_INVALID", "Git action is not approved");
    if (action.expiresAt <= this.#now()) {
      immediateTransaction(this.options.db, (tx) => {
        tx.update(resourceActions)
          .set({ status: "EXPIRED", endedAt: this.#now() })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, action.operationId, {
          status: "FAILED",
          errorCode: "EXPIRED",
          updatedAt: this.#now(),
        });
      });
      fail("APPROVAL_INVALID", "Git action expired");
    }
    const project = this.#project(action.projectId);
    const payload = GitActionSchema.parse(JSON.parse(action.paramsJson));
    const current = await this.#actionSnapshot(project.id, payload);
    if (current.snapshotVersion !== action.snapshotHash) {
      immediateTransaction(this.options.db, (tx) => {
        tx.update(resourceActions)
          .set({
            status: "FAILED",
            endedAt: this.#now(),
            resultJson: JSON.stringify({ errorCode: "GIT_CONFLICT" }),
          })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, action.operationId, {
          status: "FAILED",
          errorCode: "GIT_CONFLICT",
          updatedAt: this.#now(),
        });
      });
      throw new GitError("GIT_CONFLICT", "Repository changed after the Git action was prepared");
    }
    const lock = new ProjectWriteLock({
      db: this.options.db,
      projectId: project.id,
      rootRealPath: project.realPath,
      owner: `git:${action.id}`,
      executionId: action.id,
      ttlMs: this.options.lockTtlMs,
      now: this.options.now,
    });
    if (!lock.acquire()) throw new GitError("GIT_CONFLICT", "Project is locked by another writer");
    try {
      const locked = await this.#actionSnapshot(project.id, payload);
      if (locked.snapshotVersion !== action.snapshotHash) {
        immediateTransaction(this.options.db, (tx) => {
          tx.update(resourceActions)
            .set({
              status: "FAILED",
              endedAt: this.#now(),
              resultJson: JSON.stringify({ errorCode: "GIT_CONFLICT" }),
            })
            .where(eq(resourceActions.id, id))
            .run();
          updateOperation(tx, action.operationId, {
            status: "FAILED",
            errorCode: "GIT_CONFLICT",
            updatedAt: this.#now(),
          });
        });
        throw new GitError("GIT_CONFLICT", "Repository changed before the Git action executed");
      }
      immediateTransaction(this.options.db, (tx) => {
        const latest = tx.select().from(resourceActions).where(eq(resourceActions.id, id)).get();
        if (!latest) fail("NOT_FOUND", "Git action not found");
        if (latest.status === "COMPLETED") return;
        if (latest.status !== "PREPARED" && latest.status !== "APPROVED")
          fail("APPROVAL_INVALID", "Git action cannot be executed");
        tx.update(resourceActions)
          .set({ status: "RUNNING", startedAt: this.#now() })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, action.operationId, { status: "WRITING", updatedAt: this.#now() });
      });
      const result = await this.#run(project.realPath, JSON.parse(action.paramsJson) as GitAction);
      immediateTransaction(this.options.db, (tx) => {
        tx.update(resourceActions)
          .set({ status: "COMPLETED", endedAt: this.#now(), resultJson: JSON.stringify(result) })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, action.operationId, {
          status: "COMPLETED",
          resultJson: JSON.stringify(result),
          updatedAt: this.#now(),
        });
        appendAudit(tx, {
          action: "git.action.executed",
          decision: "allow",
          clientSessionId: client,
          resourceType: "git",
          resourceId: id,
          details: { projectId: project.id, kind: action.kind },
          now: this.#now(),
        });
      });
      return this.#view(this.#row(id));
    } catch (error) {
      const code = error instanceof GitError ? error.code : "INTERNAL";
      immediateTransaction(this.options.db, (tx) => {
        tx.update(resourceActions)
          .set({
            status: "FAILED",
            endedAt: this.#now(),
            resultJson: JSON.stringify({ errorCode: code }),
          })
          .where(eq(resourceActions.id, id))
          .run();
        updateOperation(tx, action.operationId, {
          status: "FAILED",
          errorCode: code,
          updatedAt: this.#now(),
        });
        appendAudit(tx, {
          action: "git.action.failed",
          decision: "deny",
          clientSessionId: client,
          resourceType: "git",
          resourceId: id,
          details: { projectId: project.id, kind: action.kind, errorCode: code },
          now: this.#now(),
        });
      });
      throw error;
    } finally {
      lock.release();
    }
  }
  async runAgentAction(projectId: string, input: unknown, context: AgentGitContext) {
    const action = GitActionSchema.safeParse(input);
    if (!action.success) fail("FORBIDDEN", "Invalid Git action");
    const project = this.#project(projectId);
    const before = await this.status(projectId);
    const lock = new ProjectWriteLock({
      db: this.options.db,
      projectId: project.id,
      rootRealPath: project.realPath,
      owner: context.turnId,
      executionId: `git:${context.turnId}:${context.toolCallId}`,
      ttlMs: this.options.lockTtlMs,
      now: this.options.now,
    });
    if (!lock.acquire()) throw new GitError("GIT_CONFLICT", "Project is locked by another writer");
    try {
      context.assertAuthorized();
      const current = await this.status(projectId);
      if (current.snapshotVersion !== before.snapshotVersion)
        throw new GitError("GIT_CONFLICT", "Repository changed before the Git action");
      const result = await this.#run(project.realPath, action.data);
      appendAudit(this.options.db, {
        action: "git.agent.executed",
        decision: "allow",
        resourceType: "git",
        resourceId: `${project.id}:${action.data.action}`,
        details: {
          turnId: context.turnId,
          toolCallId: context.toolCallId,
          kind: action.data.action,
        },
        now: this.#now(),
      });
      return result;
    } finally {
      lock.release();
    }
  }
  async #actionSnapshot(projectId: string, action: GitAction) {
    const snapshot = await this.status(projectId);
    if (action.action !== "discard") return snapshot;
    if (
      snapshot.conflicts.some((item) => item.path === action.path) ||
      (!snapshot.unstaged.some((item) => item.path === action.path) &&
        !snapshot.untracked.includes(action.path))
    )
      throw new GitError("GIT_CONFLICT", "File has no discardable worktree change");
    const root = this.#project(projectId).realPath;
    const relative = validateGitPath(root, action.path);
    if (relative.split("/").includes(".git") || (await realpath(root)) !== root)
      throw new GitError("GIT_CONFLICT", "Invalid discard target");
    let target = root,
      missing = false;
    const parts = relative.split("/");
    for (const [index, part] of parts.entries()) {
      target = path.join(target, part);
      try {
        const entry = await lstat(target);
        if (
          entry.isSymbolicLink() ||
          (index === parts.length - 1 ? !entry.isFile() : !entry.isDirectory())
        )
          throw new GitError("GIT_CONFLICT", "Discard requires a regular project file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && index === parts.length - 1)
          missing = true;
        else throw error;
      }
    }
    const hash = createHash("sha256")
      .update(snapshot.snapshotVersion)
      .update(missing ? "missing" : "file");
    if (!missing) {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await file.stat();
        if (!before.isFile()) throw new GitError("GIT_CONFLICT", "Discard requires a regular file");
        const buffer = Buffer.alloc(65536);
        for (;;) {
          const { bytesRead } = await file.read(buffer);
          if (!bytesRead) break;
          hash.update(buffer.subarray(0, bytesRead));
        }
        const after = await file.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
          throw new GitError("GIT_CONFLICT", "File changed while preparing discard");
      } finally {
        await file.close();
      }
    }
    return { ...snapshot, snapshotVersion: hash.digest("hex") };
  }
  async #run(root: string, action: GitAction) {
    const status = parseStatus(
      (
        await runGit(
          root,
          ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
          { readOnly: true },
        )
      ).stdout,
    );
    switch (action.action) {
      case "add": {
        const paths = action.paths.map((item) => validateGitPath(root, item));
        await runGit(root, ["--literal-pathspecs", "add", "--", ...paths], {
          timeoutMs: WRITE_TIMEOUT_MS,
        });
        return { action: "add", paths: paths.length };
      }
      case "unstage": {
        const paths = new Set<string>();
        for (const value of action.paths) {
          const item = validateGitPath(root, value);
          const entry = status.staged.find((file) => file.path === item);
          if (!entry) throw new GitError("GIT_CONFLICT", "File is no longer staged");
          paths.add(item);
          if (entry.status === "renamed" && entry.origPath)
            paths.add(validateGitPath(root, entry.origPath));
        }
        await runGit(
          root,
          [
            "--literal-pathspecs",
            ...(status.head && status.head !== "(initial)"
              ? ["reset", "-q", "HEAD"]
              : ["rm", "--cached", "-f"]),
            "--",
            ...paths,
          ],
          { timeoutMs: WRITE_TIMEOUT_MS },
        );
        return { action: "unstage", paths: paths.size };
      }
      case "discard": {
        const file = validateGitPath(root, action.path);
        if (status.conflicts.some((item) => item.path === file))
          throw new GitError("GIT_CONFLICT", "Resolve conflicts before discarding");
        if (status.untracked.includes(file))
          await runGit(root, ["--literal-pathspecs", "clean", "-f", "--", file], {
            timeoutMs: WRITE_TIMEOUT_MS,
          });
        else if (status.unstaged.some((item) => item.path === file))
          await runGit(root, ["--literal-pathspecs", "restore", "--worktree", "--", file], {
            timeoutMs: WRITE_TIMEOUT_MS,
          });
        else throw new GitError("GIT_CONFLICT", "File has no discardable worktree change");
        return { action: "discard", path: file };
      }
      case "commit": {
        if (status.staged.length === 0)
          throw new GitError("GIT_CONFLICT", "No staged changes to commit");
        await runGit(root, ["commit", "-m", action.message], { timeoutMs: WRITE_TIMEOUT_MS });
        const { stdout } = await runGit(root, ["rev-parse", "HEAD"], { readOnly: true });
        return { action: "commit", hash: stdout.trim() };
      }
      case "createBranch": {
        this.#requireClean(status);
        await runGit(root, ["check-ref-format", "--branch", action.name], { readOnly: true });
        await runGit(root, ["switch", "-c", action.name], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "createBranch", name: action.name };
      }
      case "switchBranch": {
        this.#requireClean(status);
        await runGit(root, ["check-ref-format", "--branch", action.name], { readOnly: true });
        await runGit(root, ["switch", "--no-guess", action.name], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "switchBranch", name: action.name };
      }
      case "pull": {
        this.#requireClean(status);
        if (!status.upstream) throw new GitError("GIT_CONFLICT", "Current branch has no upstream");
        await runGit(root, ["pull", "--ff-only"], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "pull" };
      }
      case "push": {
        if (!status.upstream || !status.head)
          throw new GitError("GIT_CONFLICT", "Current branch has no upstream");
        const { stdout } = await runGit(
          root,
          [
            "for-each-ref",
            "--format=%(upstream:remotename)%00%(upstream:remoteref)",
            `refs/heads/${status.branch}`,
          ],
          { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
        );
        const [remote, destination, extra] = stdout.trimEnd().split("\0");
        if (!remote || !destination?.startsWith("refs/heads/") || extra !== undefined)
          throw new GitError("GIT_CONFLICT", "Current branch has no valid upstream branch");
        await runGit(
          root,
          [
            "-c",
            `remote.${remote}.mirror=false`,
            "push",
            "--no-follow-tags",
            "--recurse-submodules=no",
            "--",
            remote,
            `${status.head}:${destination}`,
          ],
          { timeoutMs: WRITE_TIMEOUT_MS },
        );
        return { action: "push", branch: status.branch };
      }
      default:
        throw new GitError("GIT_CONFLICT", "Unsupported Git action");
    }
  }
  #requireClean(status: ReturnType<typeof parseStatus>) {
    if (status.staged.length || status.unstaged.length || status.conflicts.length)
      throw new GitError("GIT_CONFLICT", "Working tree or index is not clean");
  }
  #row(id: string) {
    const row = this.options.db
      .select()
      .from(resourceActions)
      .where(eq(resourceActions.id, id))
      .get();
    if (!row) fail("NOT_FOUND", "Git action not found");
    return row;
  }
  #view(row: ResourceActionRow): GitActionView {
    return {
      id: row.id,
      projectId: row.projectId,
      kind: row.kind as GitActionView["kind"],
      risk: row.risk,
      status: row.status,
      params: JSON.parse(row.paramsJson) as GitAction,
      paramsHash: row.paramsHash,
      snapshotVersion: row.snapshotHash,
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      expiresAt: row.expiresAt,
      decidedAt: row.decidedAt,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      result: row.resultJson ? JSON.parse(row.resultJson) : null,
      createdAt: row.createdAt,
    };
  }
}
