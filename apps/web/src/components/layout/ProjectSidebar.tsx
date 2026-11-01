import { cn, Kbd } from "@harness/ui";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  Plus,
  Search,
  Settings,
  UserRound,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { relativeTime } from "@/lib/format";
import { useSnapshot } from "@/lib/queries";
import { useNewSession } from "@/lib/useNewSession";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

export function ProjectSidebar({ mobile = false }: { mobile?: boolean }) {
  const { data } = useSnapshot();
  const { sessionId, sidebarWidth, expandedProjects, toggleProject, selectSession } =
    useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const newSession = useNewSession();
  const [query, setQuery] = useState("");

  const sessions = useMemo(
    () => [...extra, ...data.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [extra, data.sessions],
  );

  const normalized = query.trim().toLowerCase();
  const projects = data.projects.map((project) => ({
    ...project,
    sessions: sessions.filter((session) => session.projectId === project.id),
  }));
  const visibleProjects = normalized
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(normalized) ||
          project.sessions.some((session) => session.title.toLowerCase().includes(normalized)),
      )
    : projects;
  const recent = sessions
    .filter(
      (session) =>
        !normalized ||
        session.title.toLowerCase().includes(normalized) ||
        (session.projectId &&
          data.projects
            .find((project) => project.id === session.projectId)
            ?.name.toLowerCase()
            .includes(normalized)),
    )
    .slice(0, 6);

  return (
    <aside
      className={cn(
        "shrink-0 flex-col bg-surface/45",
        mobile ? "flex h-full bg-surface" : "hidden md:flex",
      )}
      style={{ width: mobile ? 268 : sidebarWidth }}
      aria-label="项目与会话导航"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-3.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#3d9bff] to-[#0066d6] text-[13px] font-bold text-white shadow-sm">
          H
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold leading-4 tracking-[-.01em]">Harness</div>
          <div className="text-[9.5px] leading-3 text-ink-3">本机工作空间</div>
        </div>
        <span className="ml-auto rounded-full border border-line bg-surface-2 px-1.5 py-[1px] font-mono text-[9px] text-ink-3">
          v0.1
        </span>
      </div>

      <div className="px-2.5">
        <button
          type="button"
          onClick={newSession}
          className="group flex h-8 w-full items-center gap-2 rounded-[9px] border border-line bg-surface px-2.5 text-[12px] font-medium text-ink shadow-[var(--shadow-card)] transition-colors hover:border-accent/30 hover:bg-accent-soft"
        >
          <Plus size={14} className="text-accent" />
          <span>新建会话</span>
          <Kbd className="ml-auto group-hover:border-accent/20">⌘K</Kbd>
        </button>
      </div>

      <div className="px-2.5 pt-2.5">
        <label className="flex h-7 items-center gap-1.5 rounded-lg bg-black/[.035] px-2 text-ink-3 transition-colors focus-within:bg-surface focus-within:ring-1 focus-within:ring-accent/30 dark:bg-white/[.05]">
          <Search size={12.5} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目或会话"
            className="h-full w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-ink-3"
            aria-label="搜索项目或会话"
          />
        </label>
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pb-2">
        <div className="flex items-center px-2 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
          项目
        </div>

        {visibleProjects.map((project) => {
          const expanded = expandedProjects[project.id] ?? true;
          return (
            <div key={project.id} className="mb-0.5">
              <button
                type="button"
                onClick={() => toggleProject(project.id)}
                aria-expanded={expanded}
                className="flex h-[27px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]"
              >
                {expanded ? (
                  <ChevronDown size={11} className="text-ink-3" />
                ) : (
                  <ChevronRight size={11} className="text-ink-3" />
                )}
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-[4px]"
                  style={{ backgroundColor: `${project.accent}18`, color: project.accent }}
                >
                  <Folder size={10} />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                {project.git ? (
                  <span className="font-mono text-[9px] text-ink-3">{project.branch}</span>
                ) : (
                  <span className="text-[9px] text-ink-3">no git</span>
                )}
              </button>

              {expanded ? (
                <div className="ml-[13px] border-l border-line/70 pl-1">
                  {project.sessions.length ? (
                    project.sessions.map((session) => (
                      <SessionRow
                        key={session.id}
                        title={session.title}
                        active={session.id === sessionId}
                        running={session.id === sessionId && isStreaming}
                        onClick={() => selectSession(session.id, project.id)}
                      />
                    ))
                  ) : (
                    <div className="px-2 py-1 text-[10.5px] text-ink-3">暂无会话</div>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="mt-3 flex items-center px-2 pb-1 text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
          最近
          <span className="ml-auto font-normal normal-case tracking-normal text-ink-3/70">
            {recent.length}
          </span>
        </div>
        {recent.map((session) => {
          const project = data.projects.find((item) => item.id === session.projectId);
          return (
            <button
              key={`recent_${session.id}`}
              type="button"
              onClick={() => selectSession(session.id, session.projectId)}
              className={cn(
                "group flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                session.id === sessionId
                  ? "bg-accent-soft/70 text-ink"
                  : "text-ink-2 hover:bg-black/[.035] dark:hover:bg-white/[.05]",
              )}
            >
              <span className="flex items-center gap-1.5">
                {session.id === sessionId && isStreaming ? (
                  <StatusDot tone="running" pulse />
                ) : (
                  <Clock3 size={11} className="shrink-0 text-ink-3" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                  {session.title}
                </span>
              </span>
              <span className="flex items-center gap-1.5 pl-[17px] text-[9.5px] text-ink-3">
                <span className="truncate">{project?.name ?? "独立会话"}</span>
                <span>·</span>
                <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line px-2 py-2">
        <BottomItem icon={Zap} label="自动化任务" />
        <BottomItem icon={Settings} label="设置与模型" />
        <BottomItem icon={Boxes} label="工作空间" />
        <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.035] dark:hover:bg-white/[.05]">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd60a] to-[#ff9f0a] text-[10px] font-semibold text-[#1d1d1f]">
            B
            <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-success ring-2 ring-surface" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-medium text-ink">bulv</div>
            <div className="truncate text-[9.5px] text-ink-3">本机操作者</div>
          </div>
          <UserRound size={13} className="text-ink-3" />
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  title,
  active,
  running,
  onClick,
}: {
  title: string;
  active: boolean;
  running: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[26px] w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] transition-colors",
        active
          ? "bg-accent-soft font-medium text-ink"
          : "text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]",
      )}
    >
      <StatusDot tone={running ? "running" : active ? "info" : "idle"} pulse={running} />
      <span className="min-w-0 flex-1 truncate">{title}</span>
    </button>
  );
}

function BottomItem({ icon: Icon, label }: { icon: typeof Zap; label: string }) {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]"
    >
      <Icon size={13.5} strokeWidth={1.75} className="text-ink-3" />
      <span>{label}</span>
    </button>
  );
}
