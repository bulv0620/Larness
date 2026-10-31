import { GitBranch, GitCommitHorizontal, GitPullRequest } from "lucide-react";
import { StatusDot } from "@/components/common/StatusDot";
import { useSnapshot } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";

const statusTone = {
  modified: "waiting",
  added: "running",
  deleted: "error",
  renamed: "info",
} as const;

export function GitPanel({ projectId }: { projectId: string | null }) {
  const { data } = useSnapshot();
  const open = useWindowStore((state) => state.open);
  const project = data.projects.find((item) => item.id === projectId);
  const changes = projectId === "prj_harness" ? data.gitChanges : [];

  if (!project?.git) {
    return (
      <div className="px-2 py-3 text-[10.5px] leading-5 text-ink-3">
        未检测到 Git 仓库。初始化 Git 后可查看分支、Diff 与提交历史。
      </div>
    );
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
