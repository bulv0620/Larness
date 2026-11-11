import type { GitAction, GitActionView } from "@larness/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  FormSelect,
  Input,
  Textarea,
} from "@larness/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Plus,
  RefreshCw,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import {
  createGitAction,
  decideGitAction,
  executeGitAction,
  readGitBranches,
  readGitStatus,
} from "@/features/git/api";
import { GitChangeTree, type GitTreeChange } from "@/features/git/GitChangeTree";
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
  if (!USE_MOCKS) return <RealGitPanel key={projectId ?? "none"} projectId={projectId} />;
  return <DemoGitPanel projectId={projectId} />;
}

function diffId(projectId: string, path: string) {
  return `diff:${projectId}:${path}`;
}

function RealGitPanel({ projectId }: { projectId: string | null }) {
  const [discardTarget, setDiscardTarget] = useState<GitTreeChange | null>(null);
  const open = useWindowStore((state) => state.open);
  const [branchOpen, setBranchOpen] = useState(false);
  const [message, setMessage] = useState("");
  const running = useRef(false);
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
  if (status.isError && !status.data)
    return <p className="px-2 py-3 text-[10.5px] text-ink-3">Git 暂不可用</p>;
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
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Git 操作失败");
      await refresh();
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const runL1 = (action: GitAction) =>
    run(async () => {
      const created = await createGitAction(projectId, action);
      const done = await executeGitAction(created.id);
      if (done.status !== "COMPLETED") throw new Error("Git 操作未完成，请重试核对。");
      if (action.action === "discard") setDiscardTarget(null);
      if (action.action === "commit") setMessage("");
      if (action.action === "createBranch") setBranchName("");
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
  const staged = changes.filter((item) => item.staged);
  const worktree = [
    ...new Map(changes.filter((item) => !item.staged).map((item) => [item.path, item])).values(),
  ];
  const disabled = busy || pending !== null || status.isError;
  const openDiff = (change: { path: string; staged: boolean }) =>
    open({
      kind: "git-diff",
      resourceId: diffId(projectId, change.path),
      title: change.path.split("/").pop() ?? change.path,
      projectId,
      source: "project",
      git: { path: change.path, staged: change.staged },
    });
  const commit = () => {
    if (!disabled && message.trim() && staged.length)
      void runL1({ action: "commit", message: message.trim() });
  };
  return (
    <div data-testid="git-panel" className="relative flex h-full min-h-0 flex-col px-1 pb-1">
      <div className="shrink-0 space-y-2 px-1 pb-2">
        <Textarea
          aria-label="提交信息"
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            }
          }}
          rows={2}
          placeholder="提交信息（⌘ / Ctrl + Enter）"
          className="resize-none py-2 text-[11px] focus:outline-none"
        />
        <button
          type="button"
          title="仅提交已暂存的更改"
          aria-label={`提交已暂存 (${staged.length})`}
          disabled={disabled || !message.trim() || !staged.length}
          onClick={commit}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-[11px] font-medium text-white transition-opacity disabled:opacity-40"
        >
          <Check size={14} />
          提交
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {(
          [
            { title: "已暂存", rows: staged },
            { title: "更改", rows: worktree },
          ] as const
        ).map((group) =>
          group.rows.length ? (
            <details key={group.title} open className="mb-1">
              <summary className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-ink-2">
                <span>{group.title}</span>
                <span className="ml-auto rounded-full bg-accent-soft px-1.5 text-[10px] text-accent">
                  {group.rows.length}
                </span>
              </summary>
              <GitChangeTree
                changes={group.rows}
                disabled={disabled}
                onOpen={openDiff}
                onStage={(path) => void runL1({ action: "add", paths: [path] })}
                onUnstage={(path) => void runL1({ action: "unstage", paths: [path] })}
                onDiscard={(change) => {
                  setError("");
                  setDiscardTarget(change);
                }}
              />
            </details>
          ) : null,
        )}
        {!changes.length ? <p className="px-2 py-3 text-[11px] text-ink-3">工作区干净</p> : null}
      </div>
      <div
        className="relative mt-1 flex shrink-0 items-center gap-1 border-t border-line px-1 pt-1.5 text-ink-3"
        role="toolbar"
        aria-label="Git 操作"
      >
        <button
          type="button"
          disabled={disabled}
          aria-label="管理分支"
          title={data.upstream ?? "未设置上游"}
          onClick={() => setBranchOpen((value) => !value)}
          aria-expanded={branchOpen}
          className="flex min-w-0 flex-1 items-center gap-1 rounded px-1 py-1 text-[10.5px] hover:bg-surface-2 disabled:opacity-40"
        >
          <GitBranch size={13} />
          <span className="truncate">{data.branch}</span>
        </button>
        <span className="shrink-0 font-mono text-[9px]" title="传入 / 传出提交">
          ↓{data.behind} ↑{data.ahead}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label="拉取（仅快进）"
          title="拉取（仅快进）"
          onClick={() => void planL2({ action: "pull" })}
          className="rounded p-1.5 hover:bg-surface-2 disabled:opacity-40"
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="推送"
          title="推送"
          onClick={() => void planL2({ action: "push" })}
          className="rounded p-1.5 hover:bg-surface-2 disabled:opacity-40"
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="刷新 Git"
          aria-busy={busy}
          title="刷新 Git"
          onClick={() => void run(async () => {})}
          className="rounded p-1.5 hover:bg-surface-2 disabled:opacity-40"
        >
          <RefreshCw size={12} className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
        </button>
        {branchOpen ? (
          <section
            aria-label="分支管理"
            className="absolute bottom-full left-0 right-0 z-10 mb-2 space-y-2 rounded-xl border border-line bg-surface p-3 shadow-lg"
          >
            <div className="flex items-center justify-between text-[11px] font-medium text-ink-2">
              分支
              <button type="button" aria-label="关闭分支管理" onClick={() => setBranchOpen(false)}>
                <X size={12} />
              </button>
            </div>
            {branches.isError ? (
              <p role="alert" className="text-[10px] text-danger">
                分支读取失败，请刷新重试。
              </p>
            ) : null}
            <FormSelect
              label="切换分支"
              value={data.branch}
              disabled={disabled || !branches.data}
              onValueChange={(name) => {
                if (name !== data.branch) void runL1({ action: "switchBranch", name });
              }}
              placeholder={data.branch}
              options={(branches.data ?? []).map((branch) => ({
                value: branch.name,
                label: branch.name,
              }))}
            />
            <form
              className="flex gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (!disabled && branchName.trim())
                  void runL1({ action: "createBranch", name: branchName.trim() });
              }}
            >
              <Input
                aria-label="新分支名"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value)}
                placeholder="新分支名"
                className="min-w-0 flex-1 py-1 text-[11px]"
              />
              <button
                type="submit"
                aria-label="创建分支"
                title="创建分支"
                disabled={disabled || !branchName.trim()}
                className="rounded border border-line px-2 disabled:opacity-40"
              >
                <Plus size={13} />
              </button>
            </form>
          </section>
        ) : null}
      </div>

      <Dialog
        open={discardTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDiscardTarget(null);
        }}
      >
        <DialogContent
          className="space-y-4 text-sm"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <DialogTitle>放弃更改？</DialogTitle>
          <DialogDescription>
            {discardTarget?.status === "untracked"
              ? "该文件尚未被 Git 跟踪，确认后将删除，无法通过 Git 恢复。"
              : "该文件的未暂存修改将丢失，恢复为暂存区版本；已暂存内容会保留。"}
          </DialogDescription>
          <p className="break-all rounded bg-surface-2 p-2 font-mono text-xs">
            {discardTarget?.path}
          </p>
          {error ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDiscardTarget(null)}>
              取消
            </Button>
            <Button
              className="bg-danger text-white"
              disabled={busy || pending !== null || status.isError}
              onClick={() => {
                if (discardTarget)
                  void runL1({ action: "discard", path: discardTarget.path, confirmed: true });
              }}
            >
              确认放弃
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {status.isError ? (
        <p role="status" className="px-2 text-[10px] text-ink-3">
          Git 状态读取失败，请刷新后继续。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="px-2 text-[10.5px] leading-4 text-danger">
          {error}
        </p>
      ) : null}
      {pending ? (
        <section
          aria-label="Git 操作审批"
          className="max-h-56 shrink-0 space-y-1.5 overflow-auto rounded border border-warning/30 bg-warning/[.05] p-2"
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
