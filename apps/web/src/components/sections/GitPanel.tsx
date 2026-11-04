import type { GitAction, GitActionView } from "@larness/shared";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, GitCommitHorizontal, GitPullRequest, Loader2 } from "lucide-react";
import { useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import {
  createGitAction,
  decideGitAction,
  executeGitAction,
  readGitBranches,
  readGitStatus,
} from "@/features/git/api";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";

const statusTone = {
  modified: "waiting",
  added: "running",
  deleted: "error",
  renamed: "info",
} as const;

export function GitPanel({ projectId }: { projectId: string | null }) {
  if (!USE_MOCKS) return <RealGitPanel projectId={projectId} />;
  return <DemoGitPanel projectId={projectId} />;
}

function diffId(projectId: string, path: string) {
  return `diff:${projectId}:${path}`;
}

function RealGitPanel({ projectId }: { projectId: string | null }) {
  const open = useWindowStore((state) => state.open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<GitActionView | null>(null);
  const [branchName, setBranchName] = useState("");
  const status = useQuery({
    queryKey: ["git", "status", projectId],
    queryFn: () => readGitStatus(projectId ?? ""),
    enabled: projectId !== null,
    refetchInterval: 3000,
    retry: false,
  });
  const branches = useQuery({
    queryKey: ["git", "branches", projectId],
    queryFn: () => readGitBranches(projectId ?? ""),
    enabled: projectId !== null,
    retry: false,
  });

  if (projectId === null)
    return <p className="px-2 py-3 text-[10.5px] text-ink-3">暂无 Git 仓库</p>;
  if (status.isPending) return <p className="px-2 py-3 text-[10.5px] text-ink-3">读取 Git 状态…</p>;
  if (status.isError) return <p className="px-2 py-3 text-[10.5px] text-ink-3">Git 暂不可用</p>;
  const data = status.data;
  if (!data) return null;
  const changes = [
    ...data.staged.map((item) => ({ ...item, staged: true })),
    ...data.unstaged.map((item) => ({ ...item, staged: false })),
    ...data.untracked.map((path) => ({
      path,
      origPath: null,
      status: "untracked",
      staged: false,
    })),
    ...data.conflicts.map((item) => ({ ...item, staged: false })),
  ];

  const refresh = async () => {
    await Promise.all([status.refetch(), branches.refetch()]);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Git 操作失败");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const runL1 = (action: GitAction) =>
    run(async () => {
      const created = await createGitAction(projectId, action);
      const done = await executeGitAction(created.id);
      if (done.status !== "COMPLETED") throw new Error("Git 操作未完成，请重试核对。");
    });
  const planL2 = (action: GitAction) =>
    run(async () => {
      const created = await createGitAction(projectId, action);
      setPending(created);
    });
  const decide = (decision: "approve" | "reject") =>
    run(async () => {
      if (!pending) return;
      const result = await decideGitAction(pending.id, decision);
      setPending(result);
      if (decision === "reject") setPending(null);
    });
  const execute = () =>
    run(async () => {
      if (!pending) return;
      const result = await executeGitAction(pending.id);
      setPending(result.status === "COMPLETED" || result.status === "FAILED" ? null : result);
      if (result.status !== "COMPLETED") throw new Error("Git 操作未完成，请核对状态后重试。");
    });
  const unstagedPaths = [...data.unstaged.map((item) => item.path), ...data.untracked].filter(
    (path) => selected.has(path),
  );

  return (
    <div data-testid="git-panel" className="max-h-[420px] space-y-2 overflow-auto px-1.5 pb-2">
      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
        <GitBranch size={13} className="text-ink-3" />
        <span className="font-mono text-[10.5px] text-ink-2">{data.branch}</span>
        <span className="truncate font-mono text-[9.5px] text-ink-3">
          {data.upstream ?? "无上游"}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-surface-2 px-1.5 py-[1px] text-[9px] text-ink-3">
          +{data.ahead}/-{data.behind}
        </span>
      </div>

      <div className="space-y-px">
        {changes.map((change) => {
          const key = `${change.staged ? "staged" : "worktree"}:${change.path}`;
          return (
            <div
              key={key}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-black/[.035] dark:hover:bg-white/[.05]"
            >
              {!change.staged && change.status !== "deleted" && change.status !== "conflicted" ? (
                <input
                  type="checkbox"
                  aria-label={`选择 ${change.path}`}
                  checked={selected.has(change.path)}
                  onChange={() =>
                    setSelected((old) => {
                      const next = new Set(old);
                      if (next.has(change.path)) next.delete(change.path);
                      else next.add(change.path);
                      return next;
                    })
                  }
                  className="h-3 w-3"
                />
              ) : (
                <span className="w-3" />
              )}
              <StatusDot tone={statusTone[change.status as keyof typeof statusTone] ?? "idle"} />
              <button
                type="button"
                onClick={() =>
                  open({
                    kind: "git-diff",
                    resourceId: diffId(projectId, change.path),
                    title: change.path.split("/").pop() ?? change.path,
                    projectId,
                    source: "project",
                    git: { path: change.path, staged: change.staged },
                  })
                }
                className="min-w-0 flex-1 truncate text-left font-mono text-[10.5px] text-ink-2"
              >
                {change.path}
              </button>
              <span className="shrink-0 font-mono text-[9px] text-ink-3">
                {change.staged ? "staged" : change.status}
              </span>
            </div>
          );
        })}
        {!changes.length ? (
          <p className="px-2 py-2 text-[10px] text-ink-3">工作区干净，没有可提交改动。</p>
        ) : null}
      </div>

      <div className="flex items-center gap-2 px-2">
        <button
          type="button"
          disabled={busy || unstagedPaths.length === 0}
          onClick={() => runL1({ action: "add", paths: unstagedPaths })}
          className="rounded border border-line px-2 py-1 text-[10px] disabled:opacity-45"
        >
          暂存选中 ({unstagedPaths.length})
        </button>
        <span className="text-[9.5px] text-ink-3">只加入显式路径</span>
      </div>

      <div className="space-y-1 px-2">
        <textarea
          aria-label="提交信息"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={2}
          placeholder="提交信息；只提交已暂存内容"
          className="w-full resize-none rounded border border-line bg-surface px-2 py-1 text-[10.5px]"
        />
        <button
          type="button"
          disabled={busy || !message.trim() || data.staged.length === 0}
          onClick={() => runL1({ action: "commit", message: message.trim() })}
          className="w-full rounded border border-line px-2 py-1 text-[10px] disabled:opacity-45"
        >
          <GitCommitHorizontal size={11} className="mr-1 inline" />
          提交已暂存 ({data.staged.length})
        </button>
      </div>

      <div className="space-y-1 border-t border-line/80 px-2 pt-2">
        <div className="flex items-center gap-1.5">
          <select
            aria-label="切换分支"
            value={data.branch}
            disabled={busy}
            onChange={(event) => {
              const name = event.target.value;
              if (name !== data.branch) void runL1({ action: "switchBranch", name });
            }}
            className="min-w-0 flex-1 rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px]"
          >
            {(branches.data ?? []).map((branch) => (
              <option key={branch.name} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
          <span className="text-[9px] text-ink-3">本地</span>
        </div>
        <div className="flex gap-1">
          <input
            aria-label="新分支名"
            value={branchName}
            onChange={(event) => setBranchName(event.target.value)}
            placeholder="新分支名"
            className="min-w-0 flex-1 rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px]"
          />
          <button
            type="button"
            disabled={busy || !branchName.trim()}
            onClick={() => runL1({ action: "createBranch", name: branchName.trim() })}
            className="rounded border border-line px-1.5 py-0.5 text-[9.5px] disabled:opacity-45"
          >
            创建
          </button>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => planL2({ action: "pull" })}
            className="flex-1 rounded border border-line px-2 py-1 text-[10px] disabled:opacity-45"
          >
            <GitPullRequest size={10} className="mr-1 inline" />
            拉取（仅快进）
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => planL2({ action: "push" })}
            className="flex-1 rounded border border-line px-2 py-1 text-[10px] disabled:opacity-45"
          >
            推送
          </button>
        </div>
      </div>

      {busy ? (
        <p role="status" className="flex items-center gap-1 px-2 text-[10px] text-ink-3">
          <Loader2 size={11} className="animate-spin" /> 正在处理…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-2 text-[10.5px] leading-4 text-danger">
          {error}；仓库已重新读取，未自动 stash / merge / reset。
        </p>
      ) : null}
      {pending ? (
        <section
          aria-label="Git 操作审批"
          className="space-y-1.5 rounded border border-warning/30 bg-warning/[.05] p-2"
        >
          <div className="flex items-center gap-2 text-[10.5px] font-medium text-ink">
            <span>Git 操作审批</span>
            <span className="ml-auto rounded-full border border-line bg-surface px-1.5 text-[9px]">
              {pending.status}
            </span>
          </div>
          <p className="break-all font-mono text-[9.5px] text-ink-3">
            {JSON.stringify(pending.params)}
          </p>
          <p className="text-[9.5px] text-ink-3">
            风险 {pending.risk} · 到期 {new Date(pending.expiresAt).toLocaleTimeString()}
          </p>
          <div className="flex gap-1">
            {pending.status === "WAITING_APPROVAL" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("approve")}
                  className="flex-1 rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-45"
                >
                  批准
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => decide("reject")}
                  className="flex-1 rounded border border-line px-2 py-1 text-[10px] disabled:opacity-45"
                >
                  拒绝
                </button>
              </>
            ) : null}
            {pending.status === "APPROVED" ? (
              <button
                type="button"
                disabled={busy}
                onClick={execute}
                className="flex-1 rounded bg-accent px-2 py-1 text-[10px] text-white disabled:opacity-45"
              >
                执行一次
              </button>
            ) : null}
            {pending.status === "FAILED" ? (
              <p className="text-[10px] text-danger">执行失败；读取最新状态后重试。</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DemoGitPanel({ projectId }: { projectId: string | null }) {
  const { data } = useSnapshot();
  const open = useWindowStore((state) => state.open);
  const project = data.projects.find((item) => item.id === projectId);
  const changes = projectId === "prj_larness" ? data.gitChanges : [];

  if (!project?.git) {
    return <div className="px-2 py-3 text-[10.5px] leading-5 text-ink-3">暂无 Git 仓库</div>;
  }

  return (
    <div className="px-1.5">
      <div className="mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5">
        <GitBranch size={13} className="text-ink-3" />
        <span className="font-mono text-[10.5px] text-ink-2">{project.branch}</span>
        <span className="ml-auto rounded-full bg-success/10 px-1.5 py-[1px] text-[9.5px] font-medium text-success">
          clean tree
        </span>
      </div>
      <div className="mb-1 flex items-center gap-2 px-2 text-[10px] text-ink-3">
        <GitCommitHorizontal size={11} />
        <span>{changes.length} 个文件改动</span>
        <span className="ml-auto flex items-center gap-1 text-accent">
          <GitPullRequest size={11} />
          PR #128
        </span>
      </div>
      <div className="space-y-px">
        {changes.map((change) => (
          <button
            key={change.path}
            type="button"
            onClick={() =>
              open({
                kind: "git-diff",
                resourceId: change.path,
                title: change.path.split("/").pop() ?? change.path,
                projectId,
                source: "project",
              })
            }
            className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-black/[.035] dark:hover:bg-white/[.05]"
          >
            <StatusDot tone={statusTone[change.status]} />
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-2">
              {change.path}
            </span>
            <span className="shrink-0 font-mono text-[9.5px] text-ink-3">
              <span className="text-success">+{change.additions}</span>{" "}
              <span className="text-danger">-{change.deletions}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
