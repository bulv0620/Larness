import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { isInsideRoot } from "../files/pathGuard.js";
import { commandEnvironment } from "../platform/environment.js";

const exec = promisify(execFile);

export type GitErrorCode =
  | "GIT_UNAVAILABLE"
  | "GIT_CONFLICT"
  | "GIT_AUTH_REQUIRED"
  | "PAYLOAD_TOO_LARGE";

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface GitFileEntry {
  path: string;
  origPath: string | null;
  status: string;
  staged: boolean;
}
export interface GitStatusData {
  branch: string;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: string[];
  conflicts: GitFileEntry[];
}
export interface GitStatusSnapshot {
  status: GitStatusData;
  snapshotVersion: string;
}
export interface GitDiffData {
  path: string;
  staged: boolean;
  diff: string;
  binary: boolean;
  truncated: boolean;
}
export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
}
export interface GitBranchEntry {
  name: string;
  current: boolean;
  head: string;
}

const MAX_OUTPUT = 2 * 1024 * 1024;

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...commandEnvironment(),
    ...(process.env.USER !== undefined ? { USER: process.env.USER } : {}),
    LC_ALL: "C",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_MERGE_AUTOEDIT: "no",
  };
  if (process.platform !== "win32") {
    env.GIT_ASKPASS = "/bin/false";
    env.SSH_ASKPASS = "/bin/false";
  }
  return env;
}

function classify(stderr: string, readOnly: boolean): GitError {
  const text = stderr.toLowerCase();
  if (
    text.includes("authentication failed") ||
    text.includes("could not read username") ||
    text.includes("permission denied") ||
    text.includes("terminal prompts disabled")
  )
    return new GitError("GIT_AUTH_REQUIRED", "Git host authentication is required");
  if (text.includes("not possible to fast-forward") || text.includes("diverging branches"))
    return new GitError("GIT_CONFLICT", "Git operation cannot be applied without a merge");
  if (text.includes("would be overwritten by"))
    return new GitError("GIT_CONFLICT", "Git operation would overwrite local changes");
  if (
    text.includes("[rejected]") &&
    (text.includes("non-fast-forward") || text.includes("fetch first"))
  )
    return new GitError("GIT_CONFLICT", "Git push requires integrating upstream changes");
  if (text.includes("not a git repository"))
    return new GitError("GIT_UNAVAILABLE", "Git repository is unavailable");
  return new GitError(
    readOnly ? "GIT_UNAVAILABLE" : "GIT_CONFLICT",
    readOnly ? "Git command failed" : "Git operation was rejected",
  );
}

export async function runGit(
  root: string,
  args: string[],
  options: {
    readOnly?: boolean;
    timeoutMs?: number;
    maxBuffer?: number;
    stdin?: string;
    /** Exit codes that carry output, e.g. `diff --no-index` returns 1 on differences. */
    allowedExitCodes?: number[];
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  try {
    const execution = exec("git", args, {
      cwd: root,
      env: gitEnvironment(),
      timeout: options.timeoutMs ?? 15_000,
      maxBuffer: options.maxBuffer ?? MAX_OUTPUT,
      encoding: "buffer",
      windowsHide: true,
    });
    if (options.stdin !== undefined) {
      const stdin = execution.child.stdin;
      // A Git error can close stdin before all pathspecs have been written.
      stdin?.on("error", () => {});
      stdin?.end(options.stdin);
    }
    const { stdout, stderr } = await execution;
    return { stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") };
  } catch (error) {
    if (!(error instanceof Error)) throw new GitError("GIT_UNAVAILABLE", "Git command failed");
    const value = error as Error & {
      code?: string | number;
      stdout?: Buffer;
      stderr?: Buffer;
      killed?: boolean;
    };
    if (typeof value.code === "number" && options.allowedExitCodes?.includes(value.code))
      return {
        stdout: (value.stdout ?? Buffer.alloc(0)).toString("utf8"),
        stderr: (value.stderr ?? Buffer.alloc(0)).toString("utf8"),
      };
    if (value.code === "ENOENT") throw new GitError("GIT_UNAVAILABLE", "Git is not installed");
    if (value.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      throw new GitError("PAYLOAD_TOO_LARGE", "Git output exceeds the limit");
    if (value.killed || value.code === "ETIMEDOUT")
      throw new GitError("GIT_CONFLICT", "Git command timed out");
    throw classify(value.stderr?.toString("utf8") ?? "", options.readOnly === true);
  }
}

export async function gitAvailable(): Promise<boolean> {
  try {
    await runGit(process.cwd(), ["--version"], { readOnly: true, timeoutMs: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export function validateGitPath(root: string, value: string, gitReported = false): string {
  if (!value || value.length > 4096 || value.includes("\0"))
    throw new GitError("GIT_CONFLICT", "Invalid Git path");
  if (path.isAbsolute(value)) throw new GitError("GIT_CONFLICT", "Git path must be relative");
  const normalized =
    gitReported && process.platform !== "win32" ? value : value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    segments.some((segment) => segment === "" || segment === "." || segment === "..") ||
    segments[0] === ".git"
  )
    throw new GitError("GIT_CONFLICT", "Invalid Git path");
  const absolute = path.resolve(root, normalized);
  if (!isInsideRoot(root, absolute)) throw new GitError("GIT_CONFLICT", "Git path escapes root");
  return normalized;
}

/**
 * Git runs inside the project directory but still reports every path relative
 * to the repository root and applies pathspecs relative to the current
 * directory. A project may be a subdirectory of a larger repository, so paths
 * have to be rebased onto the project before they are listed or reused.
 */
export async function gitPrefix(
  root: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const { stdout } = await runGit(root, ["rev-parse", "--show-prefix"], {
    readOnly: true,
    timeoutMs: options.timeoutMs ?? 15_000,
  });
  const value = stdout.trim().replaceAll("\\", "/");
  if (!value) return "";
  return value.endsWith("/") ? value : `${value}/`;
}
/**
 * Rebase the NUL separated `git status --porcelain=v2` stream onto the project
 * directory: changes outside it are dropped and the rest keep their record
 * shape, so `parseStatus` and the snapshot hash stay stable.
 */
export function scopeStatusToPrefix(raw: string, prefix: string): string {
  if (!prefix) return raw;
  const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
  const tokens = raw.split("\0");
  const scoped: string[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (!token) continue;
    const fields = token.split(" ");
    const kind = fields[0];
    if (kind === "2") {
      // A rename record is followed by its own NUL terminated source path.
      const origPath = tokens[index + 1] ?? "";
      index += 1;
      const renamed = toProjectPath(fields.slice(9).join(" "), base);
      if (renamed === null) continue;
      scoped.push([...fields.slice(0, 9), renamed].join(" "));
      // A rename that leaves the project keeps its source token so the record
      // shape stays valid; the source is not addressable as a project path.
      scoped.push(toProjectPath(origPath, base) ?? renamed);
      continue;
    }
    const head = kind === "1" ? 8 : kind === "u" ? 10 : 0;
    if (head > 0) {
      const pathValue = toProjectPath(fields.slice(head).join(" "), base);
      if (pathValue !== null) scoped.push([...fields.slice(0, head), pathValue].join(" "));
      continue;
    }
    if (kind === "?") {
      const pathValue = toProjectPath(token.slice(2), base);
      if (pathValue !== null) scoped.push(`? ${pathValue}`);
      continue;
    }
    scoped.push(token);
  }
  return scoped.map((token) => `${token}\0`).join("");
}

function toProjectPath(value: string, base: string): string | null {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized.startsWith(base)) return null;
  const relative = normalized.slice(base.length);
  return relative ? relative : null;
}

export function parseStatus(raw: string): GitStatusData {
  const tokens = raw.split("\0");
  const status: GitStatusData = {
    branch: "HEAD",
    head: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
  };
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] ?? "";
    if (!token) continue;
    if (token.startsWith("# branch.oid ")) status.head = token.slice(13).trim();
    else if (token.startsWith("# branch.head ")) status.branch = token.slice(14).trim();
    else if (token.startsWith("# branch.upstream ")) status.upstream = token.slice(18).trim();
    else if (token.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(token.slice(12).trim());
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (token.startsWith("? ")) status.untracked.push(token.slice(2));
    else if (token.startsWith("1 ")) {
      const fields = token.split(" ");
      const pathValue = fields.slice(8).join(" ");
      pushEntry(status, fields[1] ?? "..", pathValue, null);
    } else if (token.startsWith("2 ")) {
      const fields = token.split(" ");
      const pathValue = fields.slice(9).join(" ");
      const origPath = tokens[index + 1] ?? null;
      index += 1;
      pushEntry(status, fields[1] ?? "..", pathValue, origPath);
    } else if (token.startsWith("u ")) {
      const fields = token.split(" ");
      pushEntry(status, fields[1] ?? "UU", fields.slice(10).join(" "), null, true);
    }
  }
  return status;
}

function pushEntry(
  status: GitStatusData,
  codes: string,
  pathValue: string,
  origPath: string | null,
  conflict = false,
) {
  const indexCode = codes[0] ?? ".";
  const worktreeCode = codes[1] ?? ".";
  if (conflict) {
    status.conflicts.push({
      path: pathValue,
      origPath,
      status: "conflicted",
      staged: false,
    });
    return;
  }
  if (indexCode !== ".")
    status.staged.push({ path: pathValue, origPath, status: codeName(indexCode), staged: true });
  if (worktreeCode !== ".")
    status.unstaged.push({
      path: pathValue,
      origPath,
      status: codeName(worktreeCode),
      staged: false,
    });
}

function codeName(code: string): string {
  switch (code) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "typechange";
    case "U":
      return "conflicted";
    default:
      return "unknown";
  }
}

export function snapshotOf(status: GitStatusData, raw: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        head: status.head,
        branch: status.branch,
        upstream: status.upstream,
        ahead: status.ahead,
        behind: status.behind,
        raw,
      }),
    )
    .digest("hex");
}

export function parseLog(raw: string): GitLogEntry[] {
  return raw
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = "", shortHash = "", author = "", email = "", timestamp = "0", subject = ""] =
        record.split("\x1f");
      return {
        hash,
        shortHash,
        author,
        email,
        timestamp: Number(timestamp) * 1000,
        subject,
      };
    });
}

export function parseBranches(raw: string): GitBranchEntry[] {
  return raw
    .split("\n")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [name = "", head = "", current = ""] = record.split("\t");
      return { name, head, current: current.trim() === "*" };
    });
}
