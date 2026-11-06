import type {
  ServiceActionAuthorizationDto,
  ServiceOpsDeploymentDto,
  ServiceOpsServiceDto,
} from "@larness/shared";
import { Button, cn } from "@larness/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Play, RefreshCw, RotateCw, Square, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { relativeTime } from "@/lib/format";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  authorizeServiceAction,
  decideServiceAction,
  executeServiceAction,
  listFormalDeployments,
  listFormalServices,
  readFormalLogs,
  serviceOpsDeploymentsKey,
  serviceOpsLogsKey,
  serviceOpsServicesKey,
} from "./api";

const STATE_LABEL: Record<ServiceOpsServiceDto["observedState"], string> = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  unhealthy: "不健康",
  stopping: "停止中",
  failed: "失败",
  unknown: "未知",
};

function stateTone(
  state: ServiceOpsServiceDto["observedState"],
): "running" | "waiting" | "error" | "idle" {
  if (state === "running") return "running";
  if (state === "starting" || state === "stopping" || state === "unhealthy") return "waiting";
  if (state === "failed") return "error";
  return "idle";
}

function newKey(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function ServiceOpsPage() {
  const queryClient = useQueryClient();
  const sessionId = useNavigationStore((state) => state.sessionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<ServiceActionAuthorizationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const services = useQuery({
    queryKey: serviceOpsServicesKey,
    queryFn: listFormalServices,
    refetchInterval: 3_000,
  });
  const selected = useMemo(
    () => services.data?.find((item) => item.targetId === selectedId) ?? services.data?.[0] ?? null,
    [selectedId, services.data],
  );
  const deployments = useQuery({
    queryKey: selected
      ? serviceOpsDeploymentsKey(selected.targetId)
      : ["service-ops", "deployments"],
    queryFn: () => listFormalDeployments(selected?.targetId ?? ""),
    enabled: selected !== null,
    refetchInterval: 5_000,
  });
  const logs = useQuery({
    queryKey: selected ? serviceOpsLogsKey(selected.targetId) : ["service-ops", "logs"],
    queryFn: () => readFormalLogs(selected?.targetId ?? ""),
    enabled: selected !== null,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (selected === null && services.data?.[0]) setSelectedId(services.data[0].targetId);
  }, [selected, services.data]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: serviceOpsServicesKey }),
      selected
        ? queryClient.invalidateQueries({ queryKey: serviceOpsDeploymentsKey(selected.targetId) })
        : Promise.resolve(),
      selected
        ? queryClient.invalidateQueries({ queryKey: serviceOpsLogsKey(selected.targetId) })
        : Promise.resolve(),
    ]);
  };

  const execute = useMutation({
    mutationFn: async (authorization: ServiceActionAuthorizationDto) => {
      const consumed = await executeServiceAction(authorization.id, newKey("consume"));
      await refresh();
      return consumed;
    },
    onSuccess: () => {
      setPending(null);
      setError(null);
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "服务操作失败");
      void refresh();
    },
  });

  const authorize = useMutation({
    mutationFn: async (action: "start" | "stop" | "restart") => {
      if (!selected) throw new Error("未选择服务");
      const authorization = await authorizeServiceAction({
        targetId: selected.targetId,
        action,
        requestKey: newKey("action"),
        ...(sessionId ? { sessionId } : {}),
      });
      if (authorization.status === "AUTHORIZED") {
        await execute.mutateAsync(authorization);
      } else {
        setPending(authorization);
      }
      return authorization;
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "无法申请服务操作");
    },
  });

  const approve = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      if (!pending) throw new Error("没有待审批操作");
      const decided = await decideServiceAction(pending.id, decision);
      if (decided.status === "AUTHORIZED") {
        await execute.mutateAsync(decided);
      } else {
        setPending(decided);
      }
      return decided;
    },
    onError: (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "审批失败");
    },
  });

  const busy = authorize.isPending || execute.isPending || approve.isPending;

  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-canvas"
      data-testid="service-ops-page"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <Activity size={15} className="text-accent" />
        <h1 className="text-[13px] font-semibold text-ink">服务运维</h1>
        <span className="text-[10.5px] text-ink-3">正式服务 · 独立于当前聊天</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={services.isFetching}
          onClick={() => void refresh()}
        >
          <RefreshCw size={12} /> 刷新
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="w-[300px] shrink-0 overflow-y-auto border-r border-line p-2">
          {services.isPending ? (
            <p className="px-2 py-4 text-[11.5px] text-ink-3">正在读取正式服务…</p>
          ) : services.isError ? (
            <p className="px-2 py-4 text-[11.5px] text-danger">正式服务不可用</p>
          ) : services.data.length === 0 ? (
            <p className="px-2 py-4 text-[11.5px] text-ink-3">
              还没有正式服务。通过 Agent 生成计划并发布后会出现在这里。
            </p>
          ) : (
            services.data.map((service) => (
              <button
                key={service.targetId}
                type="button"
                onClick={() => setSelectedId(service.targetId)}
                className={cn(
                  "mb-1 flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left",
                  selected?.targetId === service.targetId
                    ? "border-accent/30 bg-accent-soft/50"
                    : "border-transparent hover:bg-black/[.035] dark:hover:bg-white/[.05]",
                )}
              >
                <span className="flex items-center gap-2">
                  <StatusDot tone={stateTone(service.observedState)} />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                    {service.name}
                  </span>
                  <span className="text-[10px] text-ink-3">
                    {STATE_LABEL[service.observedState]}
                  </span>
                </span>
                <span className="pl-[14px] text-[10px] text-ink-3">
                  {service.version ?? "无版本"} · {service.pid ? `PID ${service.pid}` : "无进程"}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {selected === null ? (
            <div className="rounded-xl border border-line bg-surface p-6 text-[11.5px] text-ink-3">
              选择左侧的正式服务查看状态、版本、日志和发布记录。
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {error ? (
                <div className="rounded-lg border border-danger/25 bg-danger/5 px-3 py-2 text-[11.5px] text-danger">
                  {error}
                </div>
              ) : null}
              {pending ? (
                <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11.5px]">
                  <span className="flex-1 text-ink-2">
                    「{pending.action}」需要人工审批（{pending.policy}）。
                  </span>
                  <Button size="sm" variant="primary" onClick={() => approve.mutate("approve")}>
                    批准
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => approve.mutate("reject")}>
                    拒绝
                  </Button>
                </div>
              ) : null}

              <div className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-ink">{selected.name}</h2>
                      <StatusDot tone={stateTone(selected.observedState)} />
                      <span className="text-[11px] text-ink-2">
                        {STATE_LABEL[selected.observedState]}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-[10.5px] text-ink-3">{selected.targetId}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
                      <span>版本 {selected.version ?? "无"}</span>
                      <span>PID {selected.pid ?? "无"}</span>
                      <span>期望 {selected.desiredState === "running" ? "运行" : "停止"}</span>
                      <span>
                        健康{" "}
                        {selected.lastHealthAt ? relativeTime(selected.lastHealthAt) : "未确认"}
                      </span>
                      {selected.reasonCode ? (
                        <span className="text-danger">{selected.reasonCode}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || selected.desiredState === "running"}
                      onClick={() => authorize.mutate("start")}
                    >
                      <Play size={12} /> 启动
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || selected.observedState === "stopped"}
                      onClick={() => authorize.mutate("stop")}
                    >
                      <Square size={11} /> 停止
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !selected.version}
                      onClick={() => authorize.mutate("restart")}
                    >
                      <RotateCw size={12} /> 重启
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-medium text-ink-2">
                  <Terminal size={13} /> 发布记录
                </div>
                <div className="max-h-56 overflow-y-auto p-2">
                  {deployments.isPending ? (
                    <p className="px-2 py-2 text-[11px] text-ink-3">读取中…</p>
                  ) : deployments.data?.length ? (
                    deployments.data.map((deployment) => (
                      <DeploymentRow key={deployment.id} deployment={deployment} />
                    ))
                  ) : (
                    <p className="px-2 py-2 text-[11px] text-ink-3">暂无发布记录</p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface">
                <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-medium text-ink-2">
                  <Terminal size={13} /> 运行日志
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[10.5px] leading-relaxed text-ink-2">
                  {logs.data?.text || "暂无日志"}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function DeploymentRow({ deployment }: { deployment: ServiceOpsDeploymentDto }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[10.5px]">
      <StatusDot
        tone={
          deployment.status === "SUCCEEDED"
            ? "running"
            : deployment.status === "FAILED" || deployment.status === "UNKNOWN"
              ? "error"
              : "waiting"
        }
      />
      <span className="w-20 shrink-0 font-medium text-ink">{deployment.version}</span>
      <span className="min-w-0 flex-1 truncate text-ink-3">
        {deployment.previousVersion ? `替换 ${deployment.previousVersion} · ` : "首次发布 · "}
        {deployment.reasonCode ?? deployment.status}
      </span>
      <span className="shrink-0 text-ink-3">{relativeTime(deployment.createdAt)}</span>
    </div>
  );
}
