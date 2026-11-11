import type {
  ScheduledJobApprovalPolicy,
  ScheduledJobDto,
  ScheduledJobInput,
  ScheduledJobListItemDto,
  ScheduledJobPatch,
  ScheduledJobRunDto,
  ScheduledJobRunStatus,
} from "@larness/shared";
import {
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
  FormSelect,
  Input,
  Textarea,
} from "@larness/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Clock, Play, Plus, RefreshCw, Square, Trash2, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { operationError } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { type ApiModelCatalog, listModelCatalog, listProjects } from "@/lib/workspaceApi";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  cancelJobRun,
  createJob,
  deleteJob,
  getJob,
  jobKey,
  jobRunsKey,
  jobsKey,
  jobsSummaryKey,
  listJobRuns,
  listJobs,
  runJobNow,
  updateJob,
} from "./api";

const STATUS_LABEL: Record<ScheduledJobRunStatus, string> = {
  queued: "排队中",
  running: "运行中",
  succeeded: "成功",
  failed: "失败",
  timed_out: "超时",
  cancelled: "已取消",
  interrupted: "已中断",
  skipped: "已跳过",
};

const STATUS_CLASS: Record<ScheduledJobRunStatus, string> = {
  queued: "text-warning",
  running: "text-accent",
  succeeded: "text-success",
  failed: "text-danger",
  timed_out: "text-danger",
  cancelled: "text-ink-3",
  interrupted: "text-danger",
  skipped: "text-ink-3",
};

const TRIGGER_LABEL = { scheduled: "计划", manual: "手动", catch_up: "补跑" } as const;
const KIND_LABEL = { script: "脚本", agent: "Agent" } as const;

function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function scheduleLabel(job: ScheduledJobListItemDto | ScheduledJobDto): string {
  if (job.schedule.type === "cron") {
    return `Cron ${job.schedule.expression} · ${job.schedule.timezone}`;
  }
  return `每 ${job.schedule.seconds} 秒 · ${job.schedule.timezone}`;
}

function durationLabel(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

function statusOf(job: ScheduledJobListItemDto | ScheduledJobDto): ScheduledJobRunStatus | null {
  return job.lastStatus;
}

export function JobsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ScheduledJobDto | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: jobsKey,
    queryFn: listJobs,
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  });
  const detail = useQuery({
    queryKey: jobKey(selectedId ?? ""),
    queryFn: () => getJob(selectedId ?? ""),
    enabled: open && selectedId !== null,
    refetchInterval: open && selectedId !== null ? 2_000 : false,
  });
  const runs = useQuery({
    queryKey: jobRunsKey(selectedId ?? ""),
    queryFn: () => listJobRuns(selectedId ?? ""),
    enabled: open && selectedId !== null,
    refetchInterval: open && selectedId !== null ? 2_000 : false,
  });
  const projects = useQuery({
    queryKey: ["projects", "jobs"],
    queryFn: listProjects,
    enabled: open,
  });
  const catalog = useQuery({
    queryKey: ["model-catalog", "jobs"],
    queryFn: listModelCatalog,
    enabled: open && editing !== null,
  });

  useEffect(() => {
    if (!open) {
      setSelectedId(null);
      setEditing(null);
      setConfirmDelete(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (
      jobs.data &&
      !jobs.isFetching &&
      selectedId !== null &&
      !jobs.data.items.some((job) => job.id === selectedId)
    ) {
      setSelectedId(null);
      setConfirmDelete(false);
    }
  }, [jobs.data, selectedId, jobs.isFetching]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: jobsKey });
    void queryClient.invalidateQueries({ queryKey: jobsSummaryKey });
    if (selectedId !== null) {
      void queryClient.invalidateQueries({ queryKey: jobKey(selectedId) });
      void queryClient.invalidateQueries({ queryKey: jobRunsKey(selectedId) });
    }
  };

  const runNow = useMutation({
    mutationFn: (id: string) => runJobNow(id),
    retry: false,
    onMutate: () => setError(null),
    onError: (caught) => setError(operationError(caught, "执行失败")),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => cancelJobRun(id),
    retry: false,
    onMutate: () => setError(null),
    onError: (caught) => setError(operationError(caught, "取消失败")),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteJob(id),
    retry: false,
    onMutate: () => setError(null),
    onError: (caught) => setError(operationError(caught, "删除失败")),
    onSuccess: () => {
      setSelectedId(null);
      setConfirmDelete(false);
    },
    onSettled: refresh,
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateJob(id, { enabled }),
    retry: false,
    onMutate: () => setError(null),
    onError: (caught) => setError(operationError(caught, "更新失败")),
    onSettled: refresh,
  });

  const close = () => {
    setSelectedId(null);
    setEditing(null);
    setConfirmDelete(false);
    setError(null);
    onOpenChange(false);
  };

  const current = detail.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close();
      }}
    >
      <DialogContent
        className="flex h-[min(700px,calc(100dvh-32px))] w-[min(980px,calc(100vw-32px))] flex-col overflow-hidden p-0"
        data-testid="jobs-dialog"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Clock size={14} className="text-ink-3" />
          <DialogTitle className="text-[12px] font-semibold">自动化任务</DialogTitle>
          <DialogDescription className="sr-only">
            管理 Cron / 固定间隔的脚本与 Agent 任务，查看运行历史
          </DialogDescription>
          <span className="rounded bg-surface-2 px-1.5 text-[10px] text-ink-3">
            {jobs.data?.items.length ?? 0}
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            disabled={jobs.isFetching}
            onClick={() => void jobs.refetch()}
          >
            <RefreshCw size={12} className={jobs.isFetching ? "animate-spin" : undefined} />
            刷新
          </Button>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" aria-label="关闭自动化任务">
              <X size={14} />
            </Button>
          </DialogClose>
        </header>

        <ErrorMessage
          message={error ?? (jobs.isError ? "任务列表读取失败，请刷新重试。" : null)}
          onDismiss={error ? () => setError(null) : undefined}
        />

        {editing !== null ? (
          <JobForm
            job={editing === "new" ? null : editing}
            projects={projects.data ?? []}
            catalog={catalog.data ?? null}
            onCancel={() => setEditing(null)}
            onSaved={async (saved) => {
              setEditing(null);
              setSelectedId(saved.id);
              refresh();
            }}
            onError={setError}
          />
        ) : selectedId !== null ? (
          <section className="flex min-h-0 flex-1 flex-col" aria-label="任务详情">
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label="返回任务列表"
                onClick={() => {
                  setSelectedId(null);
                  setConfirmDelete(false);
                }}
              >
                <ArrowLeft size={12} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-[12.5px] font-semibold">
                    {current?.name ?? "任务"}
                  </h3>
                  {current !== undefined && (
                    <>
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-3">
                        {KIND_LABEL[current.kind]}
                      </span>
                      <StatusBadge status={statusOf(current)} />
                      <span className="text-[10px] text-ink-3">
                        {current.enabled ? "已启用" : "已停用"}
                      </span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-ink-3">
                  {current === undefined ? "正在读取任务…" : scheduleLabel(current)}
                </p>
              </div>
              {current !== undefined && (
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => toggle.mutate({ id: current.id, enabled: !current.enabled })}
                    disabled={toggle.isPending}
                  >
                    {current.enabled ? "停用" : "启用"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => runNow.mutate(current.id)}
                    disabled={runNow.isPending}
                  >
                    <Play size={12} />
                    立即执行
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(current)}>
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setConfirmDelete(true)}
                    disabled={remove.isPending}
                  >
                    <Trash2 size={12} />
                    删除
                  </Button>
                </div>
              )}
            </div>

            {confirmDelete && current !== undefined && (
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-danger/5 px-3 py-2 text-[11px]">
                <span>删除后不再触发，运行历史保留。运行中的任务会被取消。</span>
                <div className="flex-1" />
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  取消
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => remove.mutate(current.id)}
                  disabled={remove.isPending}
                >
                  确认删除
                </Button>
              </div>
            )}

            {current === undefined ? (
              <p role="status" className="p-3 text-[11px] text-ink-3">
                正在读取任务详情…
              </p>
            ) : (
              <>
                <div className="grid shrink-0 grid-cols-2 gap-2 px-3 py-2 md:grid-cols-4">
                  <Info
                    label="下一次运行"
                    value={current.nextRunAt ? timeLabel(current.nextRunAt) : "—"}
                  />
                  <Info
                    label="最近运行"
                    value={current.lastRunAt ? relativeTime(current.lastRunAt) : "—"}
                  />
                  <Info label="超时" value={`${current.timeoutSeconds} 秒`} />
                  <Info
                    label="错过触发"
                    value={current.missedPolicy === "run_once" ? "补跑一次" : "跳过"}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <ConfigCard title="执行配置">
                      {current.kind === "script" ? (
                        <>
                          <p className="mb-2 rounded bg-warning/10 px-2 py-1.5 text-[10.5px] text-warning">
                            脚本以本机账户权限运行，不是沙箱；输出有界并脱敏。
                          </p>
                          <pre className="max-h-48 overflow-auto rounded bg-surface-2 p-2 text-[10.5px] leading-relaxed">
                            {current.script?.source ?? ""}
                          </pre>
                        </>
                      ) : (
                        <dl className="space-y-2 text-[11px]">
                          <Row
                            label="审批策略"
                            value={
                              current.agent?.approvalPolicy === "autonomous" ? "完全自主" : "只读"
                            }
                          />
                          <Row label="模型" value={current.agent?.model ?? "继承会话默认"} />
                          <Row
                            label="提示词"
                            value={
                              <span className="whitespace-pre-wrap">
                                {current.agent?.prompt ?? ""}
                              </span>
                            }
                          />
                          {current.agent?.sessionId && (
                            <Row
                              label="会话"
                              value={
                                <button
                                  type="button"
                                  className="text-accent hover:underline"
                                  onClick={() => {
                                    const navigation = useNavigationStore.getState();
                                    navigation.openPinnedSession(
                                      current.agent?.sessionId ?? "",
                                      current.projectId,
                                    );
                                    close();
                                  }}
                                >
                                  打开任务会话
                                </button>
                              }
                            />
                          )}
                        </dl>
                      )}
                    </ConfigCard>
                    <ConfigCard title="运行历史">
                      {runs.isPending ? (
                        <p className="text-[11px] text-ink-3">正在读取运行历史…</p>
                      ) : runs.data?.items.length ? (
                        <div className="space-y-2">
                          {runs.data.items.map((run) => (
                            <RunRow
                              key={run.id}
                              run={run}
                              onCancel={() => cancel.mutate(run.id)}
                              onOpenSession={
                                run.sessionId
                                  ? () => {
                                      useNavigationStore
                                        .getState()
                                        .openPinnedSession(run.sessionId ?? "", current.projectId);
                                      close();
                                    }
                                  : undefined
                              }
                              cancelling={cancel.isPending}
                            />
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-ink-3">还没有运行记录。</p>
                      )}
                    </ConfigCard>
                  </div>
                </div>
              </>
            )}
          </section>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
              <p className="text-[11px] text-ink-3">
                Cron / 固定间隔任务，支持脚本与 Agent；脚本不是沙箱。
              </p>
              <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
                <Plus size={12} />
                新建任务
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {jobs.isPending ? (
                <p role="status" className="p-2 text-[11px] text-ink-3">
                  正在读取任务…
                </p>
              ) : jobs.data?.items.length ? (
                <div className="space-y-1">
                  {jobs.data.items.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      aria-label={`${job.name} ${job.lastStatus ? STATUS_LABEL[job.lastStatus] : "未运行"}`}
                      onClick={() => setSelectedId(job.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2 text-left hover:border-line hover:bg-surface-2"
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          job.enabled ? "bg-success" : "bg-ink-3/40",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-medium">{job.name}</span>
                          <span className="rounded bg-surface-2 px-1.5 text-[9.5px] text-ink-3">
                            {KIND_LABEL[job.kind]}
                          </span>
                          {!job.enabled && <span className="text-[9.5px] text-ink-3">已停用</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-ink-3">
                          {scheduleLabel(job)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <StatusBadge status={job.lastStatus} />
                        <span className="mt-0.5 block text-[10px] text-ink-3">
                          {job.nextRunAt ? `下次 ${timeLabel(job.nextRunAt)}` : "不排期"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : jobs.isError ? null : (
                <div className="grid min-h-full place-items-center p-4">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <Clock size={20} className="text-ink-3" />
                    <p className="text-[12px] font-medium">还没有定时任务</p>
                    <p className="max-w-xs text-[10.5px] text-ink-3">
                      创建脚本或 Agent 任务，Larness 会按 Cron / 间隔在本机执行并保留运行记录。
                    </p>
                    <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
                      <Plus size={12} />
                      新建任务
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status }: { status: ScheduledJobRunStatus | null }) {
  if (status === null) {
    return <span className="text-[10px] text-ink-3">未运行</span>;
  }
  return (
    <span className={cn("text-[10px] font-medium", STATUS_CLASS[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-1.5">
      <div className="text-[9.5px] text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-[11px]">{value}</div>
    </div>
  );
}

function ConfigCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line p-2">
      <h4 className="mb-2 text-[11px] font-semibold">{title}</h4>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-16 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  );
}

function RunRow({
  run,
  onCancel,
  onOpenSession,
  cancelling,
}: {
  run: ScheduledJobRunDto;
  onCancel: () => void;
  onOpenSession?: () => void;
  cancelling: boolean;
}) {
  const active = run.status === "running" || run.status === "queued";
  return (
    <div className="rounded-lg border border-line px-2 py-1.5 text-[10.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-ink-3">{TRIGGER_LABEL[run.trigger]}</span>
        <span className="text-ink-3">{relativeTime(run.createdAt)}</span>
        <span className="text-ink-3">{durationLabel(run.durationMs)}</span>
        <span className="flex-1" />
        {active && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={cancelling}>
            <Square size={10} />
            取消
          </Button>
        )}
        {onOpenSession && (
          <Button size="sm" variant="ghost" onClick={onOpenSession}>
            打开会话
          </Button>
        )}
      </div>
      {run.output && (
        <pre className="mt-1 max-h-24 overflow-auto rounded bg-surface-2 p-1.5 text-[10px]">
          {run.output}
        </pre>
      )}
      {run.errorMessage && <p className="mt-1 text-[10px] text-danger">{run.errorMessage}</p>}
    </div>
  );
}

function JobForm({
  job,
  projects,
  catalog,
  onCancel,
  onSaved,
  onError,
}: {
  job: ScheduledJobDto | null;
  projects: Awaited<ReturnType<typeof listProjects>>;
  catalog: ApiModelCatalog | null;
  onCancel: () => void;
  onSaved: (job: ScheduledJobDto) => void;
  onError: (message: string) => void;
}) {
  const fieldId = useId();
  const [name, setName] = useState(job?.name ?? "");
  const [projectId, setProjectId] = useState(job?.projectId ?? "");
  const [kind, setKind] = useState<"script" | "agent">(job?.kind ?? "script");
  const [scheduleType, setScheduleType] = useState<"cron" | "interval">(
    job?.schedule.type ?? "cron",
  );
  const [cron, setCron] = useState(
    job?.schedule.type === "cron" ? job.schedule.expression : "0 9 * * *",
  );
  const [seconds, setSeconds] = useState(
    job?.schedule.type === "interval" ? String(job.schedule.seconds) : "300",
  );
  const [timezone, setTimezone] = useState(
    job?.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(job?.timeoutSeconds ?? 600));
  const [missedPolicy, setMissedPolicy] = useState<"skip" | "run_once">(
    job?.missedPolicy ?? "skip",
  );
  const [source, setSource] = useState(job?.script?.source ?? 'console.log("hello")');
  const [prompt, setPrompt] = useState(job?.agent?.prompt ?? "");
  const [approvalPolicy, setApprovalPolicy] = useState<ScheduledJobApprovalPolicy>(
    job?.agent?.approvalPolicy ?? "readonly",
  );
  const [modelKey, setModelKey] = useState(
    job?.agent?.model && job.agent.credentialProfileId
      ? `${job.agent.credentialProfileId}::${job.agent.model}`
      : "",
  );
  const [autonomousConfirmed, setAutonomousConfirmed] = useState(
    job?.agent?.approvalPolicy === "autonomous",
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const models = (catalog?.groups ?? []).flatMap((group) =>
    group.models
      .filter((model) => model.visible !== false)
      .map((model) => ({
        key: `${group.credentialProfileId}::${model.id}`,
        label: `${group.credentialLabel} · ${model.label}`,
      })),
  );

  const save = async () => {
    setFormError(null);
    const trimmed = name.trim();
    if (!trimmed) return setFormError("请填写任务名称");
    if (scheduleType === "cron" && cron.trim().split(/\s+/).length !== 5) {
      return setFormError("Cron 必须是 5 字段表达式");
    }
    const interval = Number(seconds);
    if (scheduleType === "interval" && (!Number.isInteger(interval) || interval < 60)) {
      return setFormError("间隔至少 60 秒");
    }
    const timeout = Number(timeoutSeconds);
    if (!Number.isInteger(timeout) || timeout < 60 || timeout > 3_600) {
      return setFormError("超时需在 60–3600 秒之间");
    }
    if (kind === "agent" && !prompt.trim()) return setFormError("请填写 Agent 提示词");
    if (kind === "script" && !source.trim()) return setFormError("请填写脚本源码");
    if (kind === "agent" && approvalPolicy === "autonomous" && !autonomousConfirmed) {
      return setFormError("请先确认完全自主风险");
    }

    const schedule =
      scheduleType === "cron"
        ? { type: "cron" as const, expression: cron.trim(), timezone: timezone.trim() }
        : { type: "interval" as const, seconds: interval, timezone: timezone.trim() };
    const [credentialProfileId, model] = modelKey ? modelKey.split("::") : [null, null];

    const input: ScheduledJobInput =
      kind === "script"
        ? {
            name: trimmed,
            projectId: projectId || null,
            kind: "script",
            schedule,
            enabled: job?.enabled ?? true,
            timeoutSeconds: timeout,
            missedPolicy,
            script: { source },
          }
        : {
            name: trimmed,
            projectId: projectId || null,
            kind: "agent",
            schedule,
            enabled: job?.enabled ?? true,
            timeoutSeconds: timeout,
            missedPolicy,
            agent: {
              prompt: prompt.trim(),
              model: model ?? null,
              credentialProfileId: credentialProfileId ?? null,
              thinking: job?.agent?.thinking ?? null,
              approvalPolicy,
            },
          };

    const patch: ScheduledJobPatch = {
      name: trimmed,
      enabled: job?.enabled ?? true,
      schedule,
      timeoutSeconds: timeout,
      missedPolicy,
      ...(kind === "script"
        ? { script: { source } }
        : {
            agent: {
              prompt: prompt.trim(),
              model: model ?? null,
              credentialProfileId: credentialProfileId ?? null,
              thinking: job?.agent?.thinking ?? null,
              approvalPolicy,
            },
          }),
    };

    setSaving(true);
    try {
      const saved = job ? await updateJob(job.id, patch) : await createJob(input);
      onSaved(saved);
    } catch (caught) {
      onError(operationError(caught, "保存任务失败，请重试。"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label="取消编辑" onClick={onCancel}>
          <ArrowLeft size={12} />
        </Button>
        <h3 className="text-[12.5px] font-semibold">{job ? "编辑任务" : "新建任务"}</h3>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="名称">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="项目">
          <FormSelect
            label="项目"
            value={projectId}
            onValueChange={setProjectId}
            disabled={job !== null}
            options={[
              { value: "", label: "默认工作区" },
              ...projects
                .filter((project) => project.kind !== "default")
                .map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
        </Field>
        <Field label="类型">
          <FormSelect
            label="类型"
            value={kind}
            onValueChange={setKind}
            disabled={job !== null}
            options={[
              { value: "script", label: "脚本" },
              { value: "agent", label: "Agent" },
            ]}
          />
        </Field>
        <Field label="触发方式">
          <FormSelect
            label="触发方式"
            value={scheduleType}
            onValueChange={setScheduleType}
            options={[
              { value: "cron", label: "Cron" },
              { value: "interval", label: "固定间隔" },
            ]}
          />
        </Field>
        {scheduleType === "cron" ? (
          <Field label="Cron（分 时 日 月 周）">
            <Input value={cron} onChange={(event) => setCron(event.target.value)} />
          </Field>
        ) : (
          <Field label="间隔（秒）">
            <Input
              type="number"
              min={60}
              value={seconds}
              onChange={(event) => setSeconds(event.target.value)}
            />
          </Field>
        )}
        <Field label="时区（IANA）">
          <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </Field>
        <Field label="超时（秒）">
          <Input
            type="number"
            min={60}
            max={3_600}
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
          />
        </Field>
        <Field label="错过触发">
          <FormSelect
            label="错过触发"
            value={missedPolicy}
            onValueChange={setMissedPolicy}
            options={[
              { value: "skip", label: "跳过" },
              { value: "run_once", label: "补跑一次" },
            ]}
          />
        </Field>
        {kind === "script" ? (
          <div className="md:col-span-2">
            <Field label="脚本源码（Node ESM）">
              <Textarea
                className="h-40 resize-y font-mono leading-relaxed"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </Field>
            <p className="mt-1 text-[10px] text-warning">
              以本机账户权限运行，不是沙箱；可使用文件与网络。
            </p>
          </div>
        ) : (
          <>
            <div className="md:col-span-2">
              <Field label="Agent 提示词">
                <Textarea
                  className="h-28 resize-y leading-relaxed"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </Field>
            </div>
            <Field label="审批策略">
              <FormSelect
                label="审批策略"
                value={approvalPolicy}
                onValueChange={(value) => {
                  setApprovalPolicy(value);
                  setAutonomousConfirmed(false);
                }}
                options={[
                  { value: "readonly", label: "只读" },
                  { value: "autonomous", label: "完全自主" },
                ]}
              />
            </Field>
            <Field label="模型">
              <FormSelect
                label="模型"
                value={modelKey}
                onValueChange={setModelKey}
                options={[
                  { value: "", label: "继承会话默认" },
                  ...models.map((model) => ({ value: model.key, label: model.label })),
                ]}
              />
            </Field>
            {approvalPolicy === "autonomous" && (
              <label
                htmlFor={`${fieldId}-confirm-autonomous`}
                className="md:col-span-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-2 py-2 text-[11px]"
              >
                <Checkbox
                  id={`${fieldId}-confirm-autonomous`}
                  className="mt-0.5"
                  checked={autonomousConfirmed}
                  onChange={(event) => setAutonomousConfirmed(event.target.checked)}
                />
                <span>
                  我了解：该任务无人值守运行，可按完全自主策略执行已登记工具（含文件写入 /
                  命令），程序具有本机账户权限且不是沙箱。
                </span>
              </label>
            )}
          </>
        )}
      </div>
      {formError && (
        <p role="alert" className="mt-2 text-[11px] text-danger">
          {formError}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void save()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the wrapped control is provided by children.
    <label className="block">
      <span className="mb-1 block text-[10.5px] text-ink-3">{label}</span>
      {children}
    </label>
  );
}
