import { DEFAULT_PROJECT_ID, type GatewaySnapshot, type SessionSummary } from "@larness/shared";
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
  Input,
  Kbd,
} from "@larness/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Archive,
  ChevronDown,
  ChevronRight,
  Clock3,
  Folder,
  FolderPlus,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  UserRound,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { useLogout } from "@/features/auth/useAuth";
import { RenameSessionDialog } from "@/features/chat/RenameSessionDialog";
import { getJobsSummary, jobsSummaryKey } from "@/features/jobs/api";
import { JobsDialog } from "@/features/jobs/JobsDialog";
import { ModelSettingsDialog } from "@/features/models/ModelSettingsDialog";
import { ProjectDialog } from "@/features/projects/ProjectDialog";
import { RenameProjectDialog } from "@/features/projects/RenameProjectDialog";
import { ServiceOpsDialog } from "@/features/serviceOps/ServiceOpsDialog";
import { operationError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import { relativeTime } from "@/lib/format";
import { applyProjectOrder, moveProjectId } from "@/lib/projectOrder";
import { useSnapshot } from "@/lib/queries";
import { useNewSession } from "@/lib/useNewSession";
import { archiveSession, deleteProject, reorderProjects } from "@/lib/workspaceApi";
import { useLocalSessionsStore } from "@/stores/localSessionsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

const PROJECT_SESSION_LIMIT = 5;

interface ProjectDragState {
  id: string;
  pointerId: number;
  startY: number;
  moved: boolean;
  targetIndex: number;
}

type ContextTarget =
  | { kind: "project"; id: string; title: string; x: number; y: number }
  | { kind: "session"; id: string; title: string; x: number; y: number };

type SidebarDialog =
  | { kind: "rename-session"; id: string; title: string }
  | { kind: "rename-project"; id: string; title: string }
  | { kind: "archive-session"; id: string; title: string }
  | { kind: "remove-project"; id: string; title: string }
  | null;

export function ProjectSidebar({ mobile = false }: { mobile?: boolean }) {
  const fieldId = useId();
  const { data } = useSnapshot();
  const {
    projectId,
    sessionId,
    draftSession,
    sidebarWidth,
    expandedProjects,
    toggleProject,
    selectSession,
    startDraft,
  } = useNavigationStore();
  const extra = useLocalSessionsStore((state) => state.extra);
  const mockRunningSessionId = useTimelineStore((state) =>
    USE_MOCKS && state.isStreaming ? state.sessionId : null,
  );
  const newSession = useNewSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const focusComposer = useNavigationStore((state) => state.focusComposer);
  const [query, setQuery] = useState("");
  const [expandedSessionLists, setExpandedSessionLists] = useState<Record<string, boolean>>({});
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serviceOpsOpen, setServiceOpsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobsSeenFailures, setJobsSeenFailures] = useState(0);
  const jobsSummary = useQuery({
    queryKey: jobsSummaryKey,
    queryFn: getJobsSummary,
    enabled: !USE_MOCKS,
    refetchInterval: 15_000,
  });
  const jobsBadge = Math.max(0, (jobsSummary.data?.failedLast24h ?? 0) - jobsSeenFailures);
  useEffect(() => {
    if (jobsOpen && jobsSummary.data) {
      setJobsSeenFailures(jobsSummary.data.failedLast24h);
    }
  }, [jobsOpen, jobsSummary.data]);

  const [context, setContext] = useState<ContextTarget | null>(null);
  const [dialog, setDialog] = useState<SidebarDialog>(null);
  const [dragState, setDragState] = useState<ProjectDragState | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousUserSelectRef = useRef("");
  const suppressProjectClickRef = useRef(false);

  useEffect(() => {
    if (context === null) return;

    const close = () => setContext(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContext(null);
    };

    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [context]);

  const openContext = (
    event: React.MouseEvent,
    kind: "project" | "session",
    id: string,
    title: string,
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    if (kind === "project" && id === DEFAULT_PROJECT_ID) {
      setContext(null);
      return;
    }
    setContext({ kind, id, title, x: event.clientX, y: event.clientY });
  };

  const sessions = useMemo(
    () => [...(USE_MOCKS ? extra : []), ...data.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [extra, data.sessions],
  );

  const newProjectSession = (projectId: string): void => {
    startDraft(projectId === DEFAULT_PROJECT_ID ? null : projectId);
    focusComposer();
  };

  const activeSession = sessions.find((item) => item.id === sessionId);
  const defaultSelected =
    projectId === null && (!activeSession || activeSession.workspaceKind === "default");
  const normalized = query.trim().toLowerCase();
  const isRunning = (session: SessionSummary): boolean =>
    session.status !== "idle" || session.id === mockRunningSessionId;
  const sessionPriority = (session: SessionSummary): number =>
    session.id === sessionId ? 2 : isRunning(session) ? 1 : 0;
  const projects = data.projects.map((project) => {
    const matchesName = project.name.toLowerCase().includes(normalized);
    return {
      ...project,
      matchesName,
      sessions: sessions.filter((session) => {
        const belongs =
          project.kind === "default"
            ? session.workspaceKind === "default"
            : session.projectId === project.id;
        return belongs && (matchesName || session.title.toLowerCase().includes(normalized));
      }),
    };
  });
  const visibleProjects = projects.filter(
    (project) => project.matchesName || project.sessions.length > 0,
  );
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
  const regularProjects = projects.filter((project) => project.kind !== "default");
  const canReorder = !USE_MOCKS && normalized.length === 0 && regularProjects.length > 1;
  const regularProjectIndex = new Map(
    regularProjects.map((project, index) => [project.id, index] as const),
  );
  const dragFromIndex = dragState
    ? regularProjects.findIndex((project) => project.id === dragState.id)
    : -1;
  const showInsertion =
    dragState?.moved === true &&
    dragState.targetIndex !== dragFromIndex &&
    dragState.targetIndex !== dragFromIndex + 1;

  const restoreUserSelect = (): void => {
    document.body.style.userSelect = previousUserSelectRef.current;
  };

  const commitProjectOrder = async (orderedIds: string[]): Promise<void> => {
    const previous = queryClient.getQueryData<GatewaySnapshot>(["workspace"]);

    if (previous) {
      queryClient.setQueryData<GatewaySnapshot>(["workspace"], {
        ...previous,
        projects: applyProjectOrder(previous.projects, orderedIds),
      });
    }

    try {
      await reorderProjects(orderedIds);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      setReorderError(null);
    } catch (error) {
      if (previous) queryClient.setQueryData(["workspace"], previous);
      setReorderError(operationError(error, "调整项目顺序失败"));
      void queryClient.invalidateQueries({ queryKey: ["workspace"] });
    }
  };

  const beginProjectDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    projectId: string,
  ): void => {
    if (!canReorder || projectId === DEFAULT_PROJECT_ID || event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works while over the project row.
    }
    previousUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    const index = regularProjects.findIndex((project) => project.id === projectId);
    setDragState({
      id: projectId,
      pointerId: event.pointerId,
      startY: event.clientY,
      moved: false,
      targetIndex: Math.max(0, index),
    });
  };

  const moveProjectDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    const rects = listRef.current
      ? Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-project-drop-index]")).map(
          (element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom };
          },
        )
      : [];

    setDragState((current) => {
      if (current === null || current.pointerId !== event.pointerId) return current;
      if (!current.moved && Math.abs(event.clientY - current.startY) < 4) return current;
      const target = rects.findIndex((rect) => event.clientY < (rect.top + rect.bottom) / 2);
      const targetIndex = target === -1 ? rects.length : target;
      if (current.moved && current.targetIndex === targetIndex) return current;
      return { ...current, moved: true, targetIndex };
    });
  };

  const endProjectDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released by the browser.
    }
    restoreUserSelect();
    const current = dragState;
    setDragState(null);
    if (!current.moved) return;
    suppressProjectClickRef.current = true;
    window.setTimeout(() => {
      suppressProjectClickRef.current = false;
    }, 0);
    const ids = regularProjects.map((project) => project.id);
    const nextIds = moveProjectId(ids, current.id, current.targetIndex);
    if (nextIds === ids) return;
    void commitProjectOrder(nextIds);
  };

  const cancelProjectDrag = (): void => {
    restoreUserSelect();
    setDragState(null);
  };

  const handleReorderKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    projectId: string,
  ): void => {
    if (!canReorder || projectId === DEFAULT_PROJECT_ID) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const ids = regularProjects.map((project) => project.id);
    const index = ids.indexOf(projectId);
    const target = index + (event.key === "ArrowUp" ? -1 : 1);
    if (index < 0 || target < 0 || target >= ids.length) return;
    const nextIds = [...ids];
    [nextIds[index], nextIds[target]] = [nextIds[target], nextIds[index]];
    void commitProjectOrder(nextIds);
  };

  useEffect(
    () => () => {
      document.body.style.userSelect = previousUserSelectRef.current;
    },
    [],
  );

  return (
    <aside
      className={cn(
        "shrink-0 flex-col bg-surface/45",
        mobile ? "flex h-full bg-surface" : "hidden md:flex",
      )}
      style={{ width: mobile ? 268 : sidebarWidth }}
      aria-label="项目与会话导航"
    >
      <div className="px-2.5 pt-3">
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
        <label
          htmlFor={`${fieldId}-search`}
          className="flex h-7 items-center gap-1.5 rounded-lg bg-black/[.035] px-2 text-ink-3 transition-colors focus-within:bg-surface focus-within:ring-1 focus-within:ring-accent/30 dark:bg-white/[.05]"
        >
          <Search size={12.5} />
          <Input
            id={`${fieldId}-search`}
            variant="bare"
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
          {!USE_MOCKS ? (
            <button
              type="button"
              onClick={() => setProjectDialogOpen(true)}
              aria-label="添加项目"
              className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
            >
              <FolderPlus size={12} />
            </button>
          ) : null}
        </div>

        <div ref={listRef} data-project-list>
          {visibleProjects.map((project) => {
            const expanded = expandedProjects[project.id] ?? true;
            const isDefault = project.kind === "default";
            const regularIndex = isDefault ? -1 : (regularProjectIndex.get(project.id) ?? -1);
            const isDragging = dragState?.id === project.id && dragState.moved;
            const navigationProjectId = isDefault ? null : project.id;
            const hasDraft = !normalized && draftSession?.projectId === navigationProjectId;
            const sessionLimit = PROJECT_SESSION_LIMIT - Number(hasDraft);
            const canExpandSessions = !normalized && project.sessions.length > sessionLimit;
            const allSessionsShown = expandedSessionLists[project.id] ?? false;
            let visibleSessions = project.sessions;
            if (canExpandSessions && !allSessionsShown) {
              const preferred = new Set(
                [...visibleSessions]
                  .sort((a, b) => sessionPriority(b) - sessionPriority(a))
                  .slice(0, sessionLimit),
              );
              visibleSessions = visibleSessions.filter((session) => preferred.has(session));
            }
            return (
              <div
                key={project.id}
                data-project-id={project.id}
                className={cn("relative mb-0.5", isDragging ? "opacity-60" : null)}
              >
                {showInsertion &&
                dragState &&
                !isDefault &&
                dragState.targetIndex === regularIndex ? (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute -top-px left-1 right-1 z-10 h-0.5 rounded-full bg-accent"
                  />
                ) : null}
                <div
                  className="flex items-center gap-0.5"
                  data-project-drop-index={isDefault ? undefined : regularIndex}
                >
                  <button
                    type="button"
                    aria-label={isDefault ? "默认工作区" : undefined}
                    aria-keyshortcuts={canReorder && !isDefault ? "ArrowUp ArrowDown" : undefined}
                    aria-pressed={isDefault ? defaultSelected : undefined}
                    title={
                      canReorder && !isDefault
                        ? "拖拽调整项目顺序；聚焦后可按上下方向键"
                        : undefined
                    }
                    onClick={() => {
                      if (suppressProjectClickRef.current) {
                        suppressProjectClickRef.current = false;
                        return;
                      }
                      if (isDefault && !defaultSelected) {
                        startDraft(null);
                        focusComposer();
                      } else toggleProject(project.id);
                    }}
                    onPointerDown={(event) => beginProjectDrag(event, project.id)}
                    onPointerMove={moveProjectDrag}
                    onPointerUp={endProjectDrag}
                    onPointerCancel={cancelProjectDrag}
                    onKeyDown={(event) => handleReorderKeyDown(event, project.id)}
                    onContextMenu={(event) =>
                      openContext(event, "project", project.id, project.name)
                    }
                    aria-expanded={expanded}
                    className={cn(
                      "flex h-[27px] min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-[11.5px] text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]",
                      canReorder && !isDefault ? "cursor-grab" : null,
                      dragState?.id === project.id ? "cursor-grabbing" : null,
                    )}
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
                    {isDefault ? (
                      <span className="text-[9px] text-ink-3">内置</span>
                    ) : project.git ? (
                      <span className="font-mono text-[9px] text-ink-3">
                        {project.branch ?? "git"}
                      </span>
                    ) : (
                      <span className="text-[9px] text-ink-3">no git</span>
                    )}
                  </button>
                  {!USE_MOCKS ? (
                    <button
                      type="button"
                      aria-label={`在 ${project.name} 中新建会话`}
                      onClick={() => newProjectSession(project.id)}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-black/[.06] hover:text-ink dark:hover:bg-white/[.08]"
                    >
                      <Plus size={11} />
                    </button>
                  ) : null}
                </div>

                {expanded ? (
                  <div className="ml-[22px] border-l border-line/70 pl-1.5">
                    {hasDraft ? (
                      <SessionRow
                        title="新会话"
                        draft
                        active={draftSession?.id === sessionId}
                        running={false}
                        onClick={() => startDraft(navigationProjectId)}
                      />
                    ) : null}
                    {visibleSessions.length ? (
                      visibleSessions.map((session) => (
                        <SessionRow
                          key={session.id}
                          title={session.title}
                          active={session.id === sessionId}
                          running={isRunning(session)}
                          onClick={() => selectSession(session.id, navigationProjectId)}
                          onContextMenu={(event) =>
                            openContext(event, "session", session.id, session.title)
                          }
                        />
                      ))
                    ) : hasDraft ? null : (
                      <div className="px-2 py-1 text-[10.5px] text-ink-3">暂无会话</div>
                    )}
                    {canExpandSessions ? (
                      <button
                        type="button"
                        aria-expanded={allSessionsShown}
                        onClick={() =>
                          setExpandedSessionLists((state) => ({
                            ...state,
                            [project.id]: !allSessionsShown,
                          }))
                        }
                        className="flex h-6 w-full items-center rounded-md pl-5 pr-2 text-left text-[10.5px] text-ink-3 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]"
                      >
                        {allSessionsShown ? "收起" : "展开更多"}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {showInsertion && dragState && dragState.targetIndex === regularProjects.length ? (
            <div className="relative h-0" aria-hidden="true">
              <div className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-accent" />
            </div>
          ) : null}
        </div>

        {visibleProjects.length === 0 ? (
          <div className="mx-1 rounded-lg border border-dashed border-line px-2.5 py-3 text-[10.5px] text-ink-3">
            {normalized
              ? "没有匹配的项目或会话"
              : "还没有登记项目。点击项目标题旁的 + 添加本机目录。"}
          </div>
        ) : null}

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
              onContextMenu={(event) => openContext(event, "session", session.id, session.title)}
              className={cn(
                "group flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors",
                session.id === sessionId
                  ? "bg-accent-soft/70 text-ink"
                  : "text-ink-2 hover:bg-black/[.035] dark:hover:bg-white/[.05]",
              )}
            >
              <span className="flex items-center gap-1.5">
                {isRunning(session) ? (
                  <SessionSpinner />
                ) : (
                  <Clock3 size={11} className="shrink-0 text-ink-3" />
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                  {session.title}
                </span>
              </span>
              <span className="flex items-center gap-1.5 pl-[17px] text-[9.5px] text-ink-3">
                <span className="truncate">
                  {project?.name ??
                    (session.workspaceKind === "default" ? "默认工作区" : "独立会话")}
                </span>
                <span>·</span>
                <span className="shrink-0">{relativeTime(session.updatedAt)}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line px-2 py-2">
        <BottomItem icon={Activity} label="服务运维" onClick={() => setServiceOpsOpen(true)} />
        <BottomItem
          icon={Zap}
          label="自动化任务"
          badge={jobsBadge}
          onClick={USE_MOCKS ? undefined : () => setJobsOpen(true)}
        />
        <BottomItem
          icon={Settings}
          label="设置与模型"
          onClick={USE_MOCKS ? undefined : () => setSettingsOpen(true)}
        />
        <div className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-black/[.035] dark:hover:bg-white/[.05]">
          <div className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#ffd60a] to-[#ff9f0a] text-[10px] font-semibold text-[#1d1d1f]">
            B
            <span className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-success ring-2 ring-surface" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-medium text-ink">bulv</div>
            <div className="truncate text-[9.5px] text-ink-3">本机操作者</div>
          </div>
          {USE_MOCKS ? (
            <UserRound size={13} className="text-ink-3" />
          ) : (
            <button
              type="button"
              aria-label="退出登录"
              title="退出登录"
              data-testid="logout-button"
              onClick={() => void logout()}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.06] hover:text-danger dark:hover:bg-white/[.08]"
            >
              <LogOut size={13} />
            </button>
          )}
        </div>
      </div>

      {context ? (
        <div
          role="menu"
          aria-label="会话或项目操作"
          onPointerDown={(event) => event.stopPropagation()}
          className="fixed z-[220] w-[184px] rounded-xl border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
          style={{
            left: Math.min(context.x, window.innerWidth - 196),
            top: Math.min(context.y, window.innerHeight - 112),
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog({
                kind: context.kind === "project" ? "rename-project" : "rename-session",
                id: context.id,
                title: context.title,
              });
              setContext(null);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] text-ink-2 hover:bg-black/[.045] hover:text-ink dark:hover:bg-white/[.07]"
          >
            <Pencil size={13} className="text-ink-3" />
            {context.kind === "project" ? "重命名项目" : "重命名会话"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setDialog({
                kind: context.kind === "project" ? "remove-project" : "archive-session",
                id: context.id,
                title: context.title,
              });
              setContext(null);
            }}
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11.5px] text-danger hover:bg-danger/10"
          >
            {context.kind === "project" ? <Trash2 size={13} /> : <Archive size={13} />}
            {context.kind === "project" ? "移除项目" : "归档会话"}
          </button>
        </div>
      ) : null}

      <ErrorMessage message={reorderError} onDismiss={() => setReorderError(null)} />

      <RenameSessionDialog
        session={dialog?.kind === "rename-session" ? { id: dialog.id, title: dialog.title } : null}
        open={dialog?.kind === "rename-session"}
        onClose={() => setDialog(null)}
      />
      <RenameProjectDialog
        project={dialog?.kind === "rename-project" ? { id: dialog.id, name: dialog.title } : null}
        open={dialog?.kind === "rename-project"}
        onClose={() => setDialog(null)}
      />
      <ConfirmActionDialog
        open={dialog?.kind === "archive-session"}
        title="归档会话"
        description={`“${dialog?.title ?? ""}”将从列表中隐藏，工作目录与源码不会被删除。`}
        confirmLabel="归档"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== "archive-session") return;
          await archiveSession(dialog.id);
          await queryClient.invalidateQueries({ queryKey: ["workspace"] });
          if (dialog.id === sessionId) selectSession("", null);
          setDialog(null);
        }}
      />
      <ConfirmActionDialog
        open={dialog?.kind === "remove-project"}
        title="移除项目"
        description={`仅移除“${dialog?.title ?? ""}”的登记，不会删除本地源码；项目内会话会变成独立会话。`}
        confirmLabel="移除项目"
        onCancel={() => setDialog(null)}
        onConfirm={async () => {
          if (dialog?.kind !== "remove-project") return;
          await deleteProject(dialog.id);
          await queryClient.invalidateQueries({ queryKey: ["workspace"] });
          if (dialog.id === projectId) selectSession("", null);
          setDialog(null);
        }}
      />

      <ProjectDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} />
      <ServiceOpsDialog open={serviceOpsOpen} onOpenChange={setServiceOpsOpen} />
      <JobsDialog open={jobsOpen} onOpenChange={setJobsOpen} />
      {!USE_MOCKS ? (
        <ModelSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </aside>
  );
}

function SessionRow({
  title,
  active,
  running,
  draft = false,
  onClick,
  onContextMenu,
}: {
  title: string;
  active: boolean;
  running: boolean;
  draft?: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={active ? "true" : undefined}
      aria-busy={running}
      className={cn(
        "flex h-[26px] w-full items-center gap-1.5 rounded-md px-2 text-left text-[11px] transition-colors",
        active
          ? "bg-accent-soft font-medium text-ink"
          : "text-ink-2 hover:bg-black/[.035] hover:text-ink dark:hover:bg-white/[.05]",
      )}
    >
      <span className="flex w-3 shrink-0 items-center justify-center" aria-hidden="true">
        {running ? <SessionSpinner /> : <StatusDot tone={active ? "info" : "idle"} />}
      </span>
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {draft ? (
        <span className="shrink-0 rounded bg-black/[.045] px-1 py-[1px] text-[8.5px] text-ink-3 dark:bg-white/[.07]">
          草稿
        </span>
      ) : null}
    </button>
  );
}

function SessionSpinner() {
  return (
    <Loader2
      size={11}
      className="shrink-0 animate-spin text-accent motion-reduce:animate-none"
      aria-hidden="true"
    />
  );
}

function BottomItem({
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  icon: typeof Zap;
  label: string;
  badge?: number;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={onClick === undefined}
      className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[11.5px] text-ink-2 transition-colors hover:bg-black/[.035] hover:text-ink disabled:cursor-default disabled:opacity-60 dark:hover:bg-white/[.05]"
    >
      <Icon size={13.5} strokeWidth={1.75} className="text-ink-3" />
      <span className="flex-1 text-left">{label}</span>
      {badge !== undefined && badge > 0 ? (
        <span
          title={`${badge} 个失败任务`}
          className="rounded-full bg-danger px-1.5 text-[9px] font-semibold leading-4 text-white"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}

function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await onConfirm();
    } catch (submitError) {
      setError(operationError(submitError, "操作失败"));
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <ErrorMessage message={error} onDismiss={() => setError(null)} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button variant="danger" size="sm" disabled={busy} onClick={() => void submit()}>
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
