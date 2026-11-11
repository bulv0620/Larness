import type { ServiceOpsDeploymentDto, ServiceOpsServiceDto } from "@larness/shared";
import {
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
} from "@larness/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Play,
  RefreshCw,
  RotateCw,
  Server,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/format";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  controlFormalService,
  listFormalDeployments,
  listFormalServices,
  readFormalLogs,
  serviceOpsDeploymentsKey,
  serviceOpsLogsKey,
  serviceOpsServicesKey,
} from "./api";

const STATES = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  unhealthy: "不健康",
  stopping: "停止中",
  failed: "失败",
  unknown: "未知",
} as const;
const ACTIONS = { start: "启动", stop: "停止", restart: "重启" } as const;
type Control = { service: ServiceOpsServiceDto; action: keyof typeof ACTIONS; requestKey: string };

export function ServiceOpsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Control | null>(null);
  const [controlError, setControlError] = useState(false);
  const services = useQuery({
    queryKey: serviceOpsServicesKey,
    queryFn: listFormalServices,
    enabled: open,
    refetchInterval: open ? 3_000 : false,
  });
  const selected = services.data?.items.find(({ targetId }) => targetId === selectedId);
  useEffect(() => {
    if (
      services.data &&
      selectedId &&
      !services.data.items.some((item) => item.targetId === selectedId)
    ) {
      setSelectedId(null);
      setConfirmation(null);
      setControlError(false);
    }
  }, [services.data, selectedId]);
  const targetId = selected?.targetId ?? "";
  const deployments = useQuery({
    queryKey: serviceOpsDeploymentsKey(targetId),
    queryFn: () => listFormalDeployments(targetId),
    enabled: open && !!selected && selected.source !== "pm2-cli",
  });
  const logs = useQuery({
    queryKey: serviceOpsLogsKey(targetId),
    queryFn: () => readFormalLogs(targetId),
    enabled: open && !!selected,
    refetchInterval: open && selected ? 3_000 : false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["service-ops"] });
  const control = useMutation({
    mutationFn: ({ service, action, requestKey }: Control) =>
      controlFormalService(service.targetId, {
        action,
        requestKey,
        expectedPm2Name: service.pm2Name,
        confirmed: true,
      }),
    retry: false,
    onSuccess: () => {
      setConfirmation(null);
      setControlError(false);
    },
    onError: () => {
      setConfirmation(null);
      setControlError(true);
    },
    onSettled: () => {
      void refresh();
    },
  });
  const requestControl = (action: Control["action"]) => {
    if (!selected || control.isPending) return;
    setControlError(false);
    const request = { service: selected, action, requestKey: crypto.randomUUID() };
    if (action === "start") control.mutate(request);
    else setConfirmation(request);
  };
  const openProject = (service: ServiceOpsServiceDto) => {
    const navigation = useNavigationStore.getState();
    if (navigation.projectId !== service.projectId || !navigation.sessionId)
      navigation.startDraft(service.projectId);
    const composer = useComposerStore.getState();
    if (!composer.draft.trim())
      composer.setDraft(`请检查 PM2 服务 ${service.pm2Name} 的状态和日志。`);
    navigation.focusComposer();
    onOpenChange(false);
  };
  const busy =
    control.isPending ||
    services.isError ||
    (!!selected && ["starting", "stopping", "unknown"].includes(selected.observedState));
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setSelectedId(null);
          setConfirmation(null);
          setControlError(false);
        }
        onOpenChange(value);
      }}
    >
      <DialogContent
        className="flex h-[min(660px,calc(100dvh-32px))] w-[min(900px,calc(100vw-32px))] flex-col overflow-hidden p-0"
        data-testid="service-ops-dialog"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <Server size={14} className="text-ink-3" />
          <DialogTitle className="text-[12px] font-semibold">服务运维</DialogTitle>
          <DialogDescription className="sr-only">
            查看正式服务状态、日志及启停操作
          </DialogDescription>
          <span className="rounded bg-surface-2 px-1.5 text-[10px] text-ink-3">
            {services.data?.items.length ?? 0}
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            disabled={services.isFetching}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} className={services.isFetching ? "animate-spin" : undefined} />
            刷新
          </Button>
          <DialogClose asChild>
            <Button size="sm" variant="ghost" aria-label="关闭服务运维">
              <X size={14} />
            </Button>
          </DialogClose>
        </header>
        <ErrorMessage
          message={
            controlError
              ? "操作失败，请刷新状态和日志后再试。"
              : services.isError
                ? services.data
                  ? "刷新失败，当前为上次观察结果。"
                  : "正式服务不可用，请刷新重试。"
                : selected && logs.isError
                  ? "日志读取失败，请刷新重试。"
                  : null
          }
          onDismiss={controlError ? () => setControlError(false) : undefined}
        />
        {services.isPending ? (
          <p role="status" className="p-3 text-[11px] text-ink-3">
            正在读取服务…
          </p>
        ) : selected ? (
          <section className="flex min-h-0 flex-1 flex-col" aria-label="服务详情">
            <div className="flex shrink-0 flex-wrap items-start gap-2 border-b border-line px-3 py-2">
              <Button
                size="sm"
                variant="ghost"
                aria-label="返回服务列表"
                onClick={() => {
                  setSelectedId(null);
                  setControlError(false);
                }}
              >
                <ArrowLeft size={12} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[12.5px] font-semibold">{selected.name}</h3>
                  <StateBadge service={selected} />
                </div>
                <p className="mt-1 text-[10px] text-ink-3">
                  所属项目 {selected.projectName ?? selected.projectId}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button size="sm" variant="secondary" onClick={() => openProject(selected)}>
                  <ArrowUpRight size={12} />
                  在项目会话中处理
                </Button>
                {selected.observedState !== "running" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || selected.reasonCode === "PM2_MISSING"}
                    onClick={() => requestControl("start")}
                  >
                    <Play size={12} />
                    启动
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || selected.observedState === "stopped"}
                  onClick={() => requestControl("restart")}
                >
                  <RotateCw size={12} />
                  重启
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy || selected.observedState === "stopped"}
                  onClick={() => requestControl("stop")}
                >
                  <Square size={11} />
                  停止
                </Button>
              </div>
            </div>
            <div className="grid shrink-0 grid-cols-2 gap-2 px-3 py-2 md:grid-cols-4">
              <Info label="PM2 服务" value={selected.pm2Name} mono />
              <Info label="进程 PID" value={selected.pid?.toString() ?? "—"} mono />
              <Info
                label="健康检查"
                value={selected.lastHealthAt ? relativeTime(selected.lastHealthAt) : "未核验"}
              />
              <Info label="最近观察" value={relativeTime(selected.updatedAt)} />
            </div>
            {control.isPending && (
              <p role="status" className="px-3 pb-2 text-[11px] text-ink-3">
                正在{ACTIONS[control.variables.action]}，等待 PM2 状态…
              </p>
            )}
            {selected.reasonCode && selected.reasonCode !== "HEALTH_UNVERIFIED" && (
              <p className="px-3 pb-2 text-[11px] text-danger [overflow-wrap:anywhere]">
                {selected.reasonCode === "PM2_MISSING"
                  ? "PM2 中已无此服务，请在项目会话中重新部署。"
                  : selected.reasonCode}
              </p>
            )}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-3 pb-3">
              <h3 className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <Terminal size={11} />
                运行日志
              </h3>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#0f1115] p-2 font-mono text-[10px] leading-5 text-[#c7ccd4]">
                {logs.isPending ? (
                  <p className="text-white/35">读取中…</p>
                ) : (
                  <pre className="whitespace-pre-wrap break-all">
                    {logs.data?.text || (logs.isError ? "日志暂不可用" : "暂无日志")}
                  </pre>
                )}
              </div>
              {logs.data?.truncated && <p className="text-[10px] text-ink-3">仅显示最近日志。</p>}
            </div>
            {selected.source !== "pm2-cli" && (
              <details className="max-h-36 shrink-0 overflow-auto border-t border-line px-3 py-2 text-[11px] text-ink-2">
                <summary className="cursor-pointer">
                  历史发布记录{selected.version ? ` · ${selected.version}` : ""}
                </summary>
                {deployments.isError ? (
                  <p>发布记录读取失败</p>
                ) : deployments.data?.length ? (
                  deployments.data.map((deployment) => (
                    <DeploymentRow key={deployment.id} deployment={deployment} />
                  ))
                ) : (
                  <p className="mt-2">暂无发布记录</p>
                )}
              </details>
            )}
          </section>
        ) : (
          <section className="min-h-0 flex-1 overflow-auto p-3" aria-label="正式服务列表">
            {services.data?.items.length ? (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {services.data.items.map((service) => (
                  <button
                    key={service.targetId}
                    type="button"
                    className="min-w-0 rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-2"
                    onClick={() => {
                      setSelectedId(service.targetId);
                      setControlError(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-medium">{service.name}</span>
                      <StateBadge service={service} />
                      <span className="ml-auto rounded bg-black/[0.04] px-1.5 py-0.5 text-[9px] text-ink-3 dark:bg-white/[0.07]">
                        PM2
                      </span>
                    </div>
                    <p className="mt-2 truncate text-[11px] text-ink-2">
                      {service.projectName ?? service.projectId}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-ink-3">
                      {service.pm2Name}
                    </p>
                    <p className="mt-2 text-[9.5px] text-ink-3">
                      {service.pid ? `PID ${service.pid} · ` : ""}观察于{" "}
                      {relativeTime(service.updatedAt)}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              !services.isError && (
                <div className="grid h-full content-center justify-items-center gap-2 text-center">
                  <Server size={22} className="text-ink-3" />
                  <p className="text-[12px] font-medium">暂无正式服务</p>
                  <p className="max-w-sm text-[11px] text-ink-3">
                    在项目会话中让 Agent 通过 PM2 部署，运行后即可查看和管理。
                  </p>
                </div>
              )
            )}
            {!!services.data?.unassociated.length && (
              <div className="mt-3 rounded-lg border border-line bg-surface-2/50 p-2.5 text-[11px] text-ink-3">
                <p>未关联项目的 PM2 服务</p>
                {services.data.unassociated.map((service) => (
                  <p
                    key={service.pm2Name}
                    className="mt-1 font-mono text-[10px] [overflow-wrap:anywhere]"
                  >
                    {service.pm2Name}
                  </p>
                ))}
              </div>
            )}
          </section>
        )}
        {services.data?.pm2Home && (
          <details className="shrink-0 border-t border-line bg-surface-2/30 px-3 py-2 text-[10px] text-ink-3">
            <summary className="cursor-pointer">本机 PM2 查询命令</summary>
            <p className="mt-2">终端查询时使用此实例目录，与页面保持一致。</p>
            <code className="mt-1 block select-all break-all font-mono text-ink-2">
              {`PM2_HOME='${services.data.pm2Home.replaceAll("'", "'\\''")}' pm2 list`}
            </code>
          </details>
        )}
        <Dialog
          open={open && !!confirmation}
          onOpenChange={(value) => {
            if (!value && !control.isPending) setConfirmation(null);
          }}
        >
          <DialogContent className="w-[min(400px,calc(100vw-32px))] space-y-3">
            <DialogTitle>{confirmation ? ACTIONS[confirmation.action] : "操作"}服务？</DialogTitle>
            <DialogDescription className="text-[12px] leading-relaxed">
              {confirmation?.action === "stop"
                ? "停止后服务将无法访问，可随时重新启动。"
                : "重启期间服务会短暂中断。"}
            </DialogDescription>
            <div className="rounded-lg border border-line bg-surface-2/50 p-2.5">
              <p className="text-[12px] font-medium">{confirmation?.service.name}</p>
              <p className="mt-1 text-[11px] text-ink-3">
                {confirmation?.service.projectName ?? confirmation?.service.projectId}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-ink-3">
                {confirmation?.service.pm2Name}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={control.isPending}
                onClick={() => setConfirmation(null)}
              >
                取消
              </Button>
              <Button
                size="sm"
                variant={confirmation?.action === "stop" ? "danger" : "primary"}
                disabled={control.isPending}
                onClick={() => {
                  if (confirmation) control.mutate(confirmation);
                }}
              >
                {control.isPending
                  ? "处理中…"
                  : `确认${confirmation ? ACTIONS[confirmation.action] : "操作"}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
function StateBadge({ service }: { service: ServiceOpsServiceDto }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-[1px] text-[9px]",
        service.observedState === "running"
          ? "border-success/20 bg-success/10 text-success"
          : service.observedState === "failed" || service.observedState === "unhealthy"
            ? "border-danger/20 bg-danger/10 text-danger"
            : "border-line bg-surface-2 text-ink-3",
      )}
    >
      {STATES[service.observedState]}
    </span>
  );
}
function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface-2/50 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className={cn("mt-1 truncate text-[11px]", mono && "font-mono")} title={value}>
        {value}
      </p>
    </div>
  );
}
function DeploymentRow({ deployment }: { deployment: ServiceOpsDeploymentDto }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-3">
      <span>{deployment.version}</span>
      <span>{deployment.reasonCode ?? deployment.status}</span>
      <span>{relativeTime(deployment.createdAt)}</span>
    </div>
  );
}
