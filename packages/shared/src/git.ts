import { z } from "zod";

const GitPathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes("\0"), "Git path cannot contain NUL");
const GitBranchNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("\0") && !value.startsWith("-"), "Invalid branch name");

export const GitAddActionSchema = z
  .object({ action: z.literal("add"), paths: z.array(GitPathSchema).min(1).max(200) })
  .strict();
export const GitCommitActionSchema = z
  .object({ action: z.literal("commit"), message: z.string().min(1).max(4000) })
  .strict();
export const GitCreateBranchActionSchema = z
  .object({ action: z.literal("createBranch"), name: GitBranchNameSchema })
  .strict();
export const GitSwitchBranchActionSchema = z
  .object({ action: z.literal("switchBranch"), name: GitBranchNameSchema })
  .strict();
export const GitPullActionSchema = z.object({ action: z.literal("pull") }).strict();
export const GitPushActionSchema = z.object({ action: z.literal("push") }).strict();
export const GitActionSchema = z.union([
  GitAddActionSchema,
  GitCommitActionSchema,
  GitCreateBranchActionSchema,
  GitSwitchBranchActionSchema,
  GitPullActionSchema,
  GitPushActionSchema,
]);
export type GitAction = z.infer<typeof GitActionSchema>;
export type GitActionKind = GitAction["action"];

export const GitActionDecisionSchema = z
  .object({ decision: z.enum(["approve", "reject"]) })
  .strict();
export const GitDiffQuerySchema = z
  .object({
    path: z.string().min(1).max(4096),
    staged: z.enum(["true", "false"]).default("false"),
  })
  .strict();
export const GitLogQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();
export const GitBranchesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: z.coerce.number().int().nonnegative().default(0),
  })
  .strict();

export interface GitStatusView {
  branch: string;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: { path: string; origPath: string | null; status: string }[];
  unstaged: { path: string; origPath: string | null; status: string }[];
  untracked: string[];
  conflicts: { path: string; origPath: string | null; status: string }[];
  snapshotVersion: string;
}
export interface GitDiffView {
  path: string;
  staged: boolean;
  diff: string;
  binary: boolean;
  truncated: boolean;
}
export interface GitLogView {
  hash: string;
  shortHash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
}
export interface GitBranchView {
  name: string;
  current: boolean;
  head: string;
}
export interface GitActionView {
  id: string;
  projectId: string;
  kind: GitActionKind;
  risk: "L1" | "L2";
  status:
    | "PREPARED"
    | "WAITING_APPROVAL"
    | "APPROVED"
    | "RUNNING"
    | "COMPLETED"
    | "FAILED"
    | "REJECTED"
    | "EXPIRED"
    | "INTERRUPTED";
  params: GitAction;
  paramsHash: string;
  snapshotVersion: string;
  requestedBy: string;
  decidedBy: string | null;
  expiresAt: number;
  decidedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  result: unknown;
  createdAt: number;
}
