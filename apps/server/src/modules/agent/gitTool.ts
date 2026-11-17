import { defineTool, type ToolDefinition } from "@larness/agent";
import { z } from "zod";

const Empty = z.object({}).strict();
const Diff = z
  .object({ path: z.string().min(1).max(4096), staged: z.boolean().default(false) })
  .strict();
const Log = z
  .object({
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z.number().int().nonnegative().default(0),
  })
  .strict();
const Branches = z
  .object({
    limit: z.number().int().min(1).max(200).default(100),
    cursor: z.number().int().nonnegative().default(0),
  })
  .strict();
const Add = z.object({ paths: z.array(z.string().min(1).max(4096)).min(1).max(200) }).strict();
const Commit = z.object({ message: z.string().min(1).max(4000) }).strict();
const Branch = z.object({ name: z.string().min(1).max(255) }).strict();

function unavailable(summary: string) {
  return { ok: false as const, errorCode: "FORBIDDEN", summary };
}

export function createGitTools(): ToolDefinition[] {
  const read = (
    name: string,
    operation: "status" | "diff" | "log" | "branches",
    description: string,
    schema: z.ZodType,
    summarize: (args: unknown) => string,
  ) =>
    defineTool({
      name,
      description,
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema,
      summarize,
      handler: async (args, context) =>
        context.gitRead ? context.gitRead(operation, args) : unavailable("Git context unavailable"),
    });
  const action = (
    name: string,
    riskLevel: "L1" | "L2",
    description: string,
    schema: z.ZodType,
    summarize: (args: unknown) => string,
  ) =>
    defineTool({
      name,
      description,
      riskLevel,
      requiresProject: true,
      requiresProjectLock: false,
      schema,
      summarize,
      handler: async (args, context) =>
        context.gitAction ? context.gitAction(args) : unavailable("Git action context unavailable"),
    });
  return [
    read(
      "git_status",
      "status",
      "Read structured Git branch, staged / unstaged / untracked files and snapshot version. Fails with GIT_UNAVAILABLE when the project is not a Git repository or Git is missing; do not retry the same call.",
      Empty,
      () => "读取 Git 状态",
    ),
    read(
      "git_diff",
      "diff",
      "Read a bounded diff for one literal project-relative path, optionally staged.",
      Diff,
      (args) => `查看 Git Diff ${(args as { path: string }).path}`,
    ),
    read(
      "git_log",
      "log",
      "Read recent commits as structured data, without external diff helpers.",
      Log,
      () => "读取 Git 提交历史",
    ),
    read(
      "git_branches",
      "branches",
      "List local branches and the current branch.",
      Branches,
      () => "读取 Git 分支",
    ),
    action(
      "git_add",
      "L1",
      "Stage only the explicitly listed literal project-relative paths; an explicitly listed directory includes its contents.",
      Add,
      (args) => `暂存 ${(args as { paths: string[] }).paths.length} 个路径`,
    ),
    action(
      "git_commit",
      "L1",
      "Commit the staged changes with a message. Never adds files automatically.",
      Commit,
      () => "提交已暂存修改",
    ),
    action(
      "git_create_branch",
      "L1",
      "Create and switch to a new local branch; requires a clean working tree and index.",
      Branch,
      (args) => `创建分支 ${(args as { name: string }).name}`,
    ),
    action(
      "git_switch_branch",
      "L1",
      "Switch to an existing local branch; requires a clean working tree and index.",
      Branch,
      (args) => `切换分支 ${(args as { name: string }).name}`,
    ),
    action(
      "git_pull",
      "L2",
      "Pull the current branch with --ff-only when an upstream is configured. Local changes are kept unless the incoming commits would overwrite them; then it fails with GIT_CONFLICT. Never stashes, merges or resets.",
      Empty,
      () => "拉取当前分支（仅快进）",
    ),
    action(
      "git_push",
      "L2",
      "Push the current branch to its configured upstream, without force.",
      Empty,
      () => "推送当前分支",
    ),
  ];
}
