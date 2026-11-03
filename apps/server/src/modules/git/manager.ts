import { createHash } from "node:crypto";
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
      ["status", "--porcelain=v2", "-z", "--branch"],
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
      ["diff", "--numstat", ...(staged ? ["--cached"] : []), "--", path],
      { readOnly: true, timeoutMs: READ_TIMEOUT_MS },
    );
    const binary = numstat.stdout.split("\n").some((line) => line.startsWith("-\t-\t"));
    try {
      const result = await runGit(
        project.realPath,
        [
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
    return this.status(projectId).then((snapshot) => {
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
    const current = await this.status(project.id);
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
      const locked = await this.status(project.id);
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
  async #run(root: string, action: GitAction) {
    const status = parseStatus(
      (await runGit(root, ["status", "--porcelain=v2", "-z", "--branch"], { readOnly: true }))
        .stdout,
    );
    switch (action.action) {
      case "add": {
        const paths = action.paths.map((item) => validateGitPath(root, item));
        await runGit(root, ["add", "--", ...paths], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "add", paths: paths.length };
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
        await runGit(root, ["switch", action.name], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "switchBranch", name: action.name };
      }
      case "pull": {
        this.#requireClean(status);
        if (!status.upstream) throw new GitError("GIT_CONFLICT", "Current branch has no upstream");
        await runGit(root, ["pull", "--ff-only"], { timeoutMs: WRITE_TIMEOUT_MS });
        return { action: "pull" };
      }
      case "push": {
        if (!status.upstream) throw new GitError("GIT_CONFLICT", "Current branch has no upstream");
        await runGit(root, ["push"], { readOnly: false, timeoutMs: WRITE_TIMEOUT_MS });
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
