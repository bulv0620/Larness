import { Tabs, TabsList, TabsTrigger } from "@larness/ui";
import { Files, GitBranch } from "lucide-react";
import { FileTreePanel } from "@/components/sections/FileTreePanel";
import { GitPanel } from "@/components/sections/GitPanel";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";

const resources = [
  { id: "files", label: "文件", icon: Files },
  { id: "git", label: "Git", icon: GitBranch },
] as const;

type ResourceId = (typeof resources)[number]["id"];

export function ProjectResourceSidebar({ onQuickOpen }: { onQuickOpen?: () => void } = {}) {
  const { data } = useSnapshot();
  const projectId = useNavigationStore((state) => state.projectId);
  const resourceWidth = useNavigationStore((state) => state.resourceWidth);
  const active = useNavigationStore((state) => state.resourceTab);
  const setActive = useNavigationStore((state) => state.setResourceTab);
  const projectChanges = projectId === "prj_larness" ? data.gitChanges : [];
  const counts: Record<ResourceId, number | undefined> = {
    files: USE_MOCKS ? (projectId === "prj_larness" ? 22 : 0) : undefined,
    git: USE_MOCKS ? projectChanges.length : undefined,
  };

  return (
    <aside
      aria-label="项目资源"
      data-project-resources
      className="hidden shrink-0 bg-surface/40 xl:flex xl:flex-col"
      style={{ width: resourceWidth }}
    >
      <Tabs
        value={active}
        onValueChange={(value) => setActive(value as ResourceId)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 px-2.5 pb-1.5 pt-2.5">
          <TabsList aria-label="项目资源分区" className="flex w-full">
            {resources.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                id={`resource-tab-${id}`}
                value={id}
                className="h-7 flex-1 justify-center gap-1.5 px-2"
              >
                <Icon size={13} className="shrink-0" />
                <span className="truncate">{label}</span>
                {typeof counts[id] === "number" ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[10px] leading-4 text-ink-3">
                    {counts[id]}
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div
          role="tabpanel"
          id="resource-files"
          aria-labelledby="resource-tab-files"
          hidden={active !== "files"}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          <FileTreePanel projectId={projectId} onQuickOpen={onQuickOpen} />
        </div>
        <div
          role="tabpanel"
          id="resource-git"
          aria-labelledby="resource-tab-git"
          hidden={active !== "git"}
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2"
        >
          <GitPanel projectId={projectId} />
        </div>
      </Tabs>
    </aside>
  );
}
