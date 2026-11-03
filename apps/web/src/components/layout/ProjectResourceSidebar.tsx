import { cn } from "@larness/ui";
import { Files, GitBranch, Server, SquareTerminal } from "lucide-react";
import { Fragment, useState } from "react";
import { FileTreePanel } from "@/components/sections/FileTreePanel";
import { GitPanel } from "@/components/sections/GitPanel";
import { ResizableSection } from "@/components/sections/ResizableSection";
import { SectionSplitter } from "@/components/sections/SectionSplitter";
import { ServicesPanel } from "@/components/sections/ServicesPanel";
import { TerminalsPanel } from "@/components/sections/TerminalsPanel";
import { useSectionResizer } from "@/components/sections/useSectionResizer";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useNavigationStore } from "@/stores/navigationStore";

const initialSections = [
  { id: "files", title: "文件", size: 0.34, expanded: true },
  { id: "services", title: "服务", size: 0.22, expanded: true },
  { id: "terminals", title: "终端", size: 0.22, expanded: true },
  { id: "git", title: "Git", size: 0.22, expanded: true },
];

type ResourceView = "all" | "files" | "services" | "terminals" | "git";

const icons = {
  files: Files,
  services: Server,
  terminals: SquareTerminal,
  git: GitBranch,
} as const;

export function ProjectResourceSidebar() {
  const { data } = useSnapshot();
  const projectId = useNavigationStore((state) => state.projectId);
  const resourceWidth = useNavigationStore((state) => state.resourceWidth);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const projectServices = data.services.filter((service) => service.projectId === projectId);
  const projectTerminals = data.terminals.filter((terminal) => terminal.projectId === projectId);
  const projectChanges = projectId === "prj_larness" ? data.gitChanges : [];
  const [view, setView] = useState<ResourceView>("all");
  const { sections, containerRef, toggle, onPointerDown, equalize, nudge } =
    useSectionResizer(initialSections);

  const counts = {
    files: USE_MOCKS ? (projectId === "prj_larness" ? 22 : 0) : undefined,
    services: projectServices.length,
    terminals: USE_MOCKS ? projectTerminals.length : undefined,
    git: projectChanges.length,
  };

  const tabs: Array<{ id: ResourceView; label: string; count?: number; running?: boolean }> = [
    { id: "all", label: "全部" },
    { id: "files", label: "文件", count: counts.files },
    {
      id: "services",
      label: "服务",
      count: counts.services,
      running: projectServices.some((service) => service.status === "running"),
    },
    {
      id: "terminals",
      label: "终端",
      count: counts.terminals,
      running: projectTerminals.some((terminal) => terminal.status === "running"),
    },
    { id: "git", label: "Git", count: counts.git },
  ];

  const solo = sections.find((section) => section.id === view);
  const expandedTotal = Math.max(
    0.0001,
    sections.reduce((sum, section) => sum + (section.expanded ? section.size : 0), 0),
  );

  const renderPanel = (id: string) => {
    if (id === "files") return <FileTreePanel projectId={projectId} />;
    if (id === "services") return <ServicesPanel projectId={projectId} />;
    if (id === "terminals") return <TerminalsPanel projectId={projectId} />;
    return <GitPanel projectId={projectId} />;
  };

  return (
    <aside
      aria-label="项目资源"
      className="hidden shrink-0 bg-surface/40 xl:flex xl:flex-col"
      style={{ width: resourceWidth }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-3">
          项目资源
        </span>
        <span className="ml-auto max-w-[140px] truncate rounded-full bg-black/[.045] px-1.5 py-[1px] text-[9.5px] font-medium text-ink-3 dark:bg-white/[.06]">
          {project?.name ?? "未选择项目"}
        </span>
      </div>

      <div
        role="tablist"
        aria-label="项目资源视图"
        className="mx-2 mb-1 flex h-8 shrink-0 items-center gap-0.5 rounded-[9px] bg-black/[.035] p-0.5 dark:bg-white/[.05]"
      >
        {tabs.map((tab) => {
          const active = view === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setView(tab.id)}
              className={cn(
                "relative flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded-[7px] px-1 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                active
                  ? "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,.06)] ring-1 ring-line"
                  : "text-ink-3 hover:bg-black/[.03] hover:text-ink-2 dark:hover:bg-white/[.04]",
              )}
            >
              {tab.running ? (
                <span className="h-1 w-1 shrink-0 rounded-full bg-success" aria-hidden />
              ) : null}
              <span className="truncate">{tab.label}</span>
              {typeof tab.count === "number" && tab.count > 0 ? (
                <span
                  className={cn("shrink-0 text-[9px]", active ? "text-ink-3" : "text-ink-3/70")}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col px-2 pb-2">
        {view === "all" ? (
          sections.map((section, index) => {
            const next = sections[index + 1];
            return (
              <Fragment key={section.id}>
                <ResizableSection
                  title={section.title}
                  icon={icons[section.id as keyof typeof icons]}
                  count={counts[section.id as keyof typeof counts]}
                  expanded={section.expanded}
                  size={section.size / expandedTotal}
                  onToggle={() => toggle(section.id)}
                >
                  {renderPanel(section.id)}
                </ResizableSection>

                {next?.expanded && section.expanded ? (
                  <SectionSplitter
                    value={section.size / expandedTotal}
                    onPointerDown={(event) => onPointerDown(index, event)}
                    onDoubleClick={() => equalize(index)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                        event.preventDefault();
                        const step = event.shiftKey ? 64 : 16;
                        nudge(index, event.key === "ArrowDown" ? step : -step);
                      }
                    }}
                  />
                ) : null}
              </Fragment>
            );
          })
        ) : solo ? (
          <ResizableSection
            title={solo.title}
            icon={icons[solo.id as keyof typeof icons]}
            count={counts[solo.id as keyof typeof counts]}
            expanded
            size={1}
            onToggle={() => setView("all")}
          >
            {renderPanel(solo.id)}
          </ResizableSection>
        ) : null}
      </div>
    </aside>
  );
}
