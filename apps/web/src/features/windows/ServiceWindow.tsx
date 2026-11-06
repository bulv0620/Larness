import type { ServiceDto } from "@larness/shared";
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle } from "@larness/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Plus, Server, SquareTerminal } from "lucide-react";
import { useState } from "react";
import {
  createServiceAction,
  decideServiceAction,
  deleteService,
  executeServiceAction,
  listServices,
  readService,
  readServiceLogs,
  serviceKey,
  serviceLogsKey,
  servicesKey,
  stopService,
} from "@/features/services/api";
import { listTerminals, openTerminal, readTerminal } from "@/features/terminals/api";
import { ApiError } from "@/lib/api";
import type { WindowTab } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";

function statusLabel(status: ServiceDto["status"]) {
  return status === "RUNNING"
    ? "运行中"
    : status === "UNKNOWN"
      ? "不可用"
      : status === "UNREGISTERED"
        ? "已结束"
        : status;
}

function timeLabel(value: number) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

const TERMINAL_ACTION_CODES = new Set([
  "PREVIEW_TARGET_INVALID",
  "APPROVAL_INVALID",
  "CONFLICT",
  "RESOURCE_UNAVAILABLE",
  "NOT_FOUND",
  "EXPIRED",
]);

function registrationError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === "PREVIEW_TARGET_INVALID") {
      return "无法登记：该端口没有可核验、且属于此终端的监听。请确认服务已在该终端启动；能登记但访问不了时，预览会显示不可用。";
    }
    if (cause.code === "APPROVAL_INVALID" || cause.code === "EXPIRED") {
      return "这次登记已结束（执行失败或过期），请重新登记。";
    }
    return cause.message;
  }
  return cause instanceof Error ? cause.message : "登记失败";
}

function closesAction(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    (TERMINAL_ACTION_CODES.has(cause.code) || cause.status === 401 || cause.status === 403)
  );
}

const selectedServiceByTab = new Map<string, string>();

function serviceIdFrom(result: unknown): string | null {
  if (
    typeof result === "object" &&
    result !== null &&
    "serviceId" in result &&
    typeof result.serviceId === "string"
  )
    return result.serviceId;
  return null;
}

export function ServiceWindow({ tab }: { tab: WindowTab }) {
  const projectId = tab.projectId;
  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-3">
        选择一个项目后查看服务
      </div>
    );
  }
  return (
    <LiveServiceWindow
      projectId={projectId}
      tabId={tab.id}
      initialId={
        tab.resourceId.startsWith("svc_")
          ? tab.resourceId
          : (selectedServiceByTab.get(tab.id) ?? null)
      }
    />
  );
}

function LiveServiceWindow({
  projectId,
  tabId,
  initialId,
}: {
  projectId: string;
  tabId: string;
  initialId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const select = (id: string | null) => {
    if (id) selectedServiceByTab.set(tabId, id);
    else selectedServiceByTab.delete(tabId);
    setSelectedId(id);
  };
  const [registerOpen, setRegisterOpen] = useState(false);
  const query = useQuery({
    queryKey: servicesKey(projectId),
    queryFn: () => listServices(projectId),
    refetchInterval: 2000,
  });
  if (selectedId) {
    return (
      <ServiceDetail
        id={selectedId}
        onBack={() => select(null)}
        onRefresh={() => void query.refetch()}
      />
    );
  }
  const services = query.data ?? [];
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Server size={14} className="text-ink-3" />
        <span className="text-[12px] font-semibold text-ink">服务</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3">
          {services.length}
        </span>
        <Button
          className="ml-auto"
          size="sm"
          variant="secondary"
          leading={<Plus size={12} />}
          onClick={() => setRegisterOpen(true)}
        >
          登记服务
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {query.isError ? (
          <p role="alert" className="text-[11px] text-danger">
            服务读取失败，请稍后重试。
          </p>
        ) : null}
        {services.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Server size={22} className="text-ink-3" />
            <div className="space-y-1">
              <p className="text-[12px] font-medium text-ink">当前项目暂无服务</p>
              <p className="max-w-[320px] text-[11px] text-ink-3">
                在项目终端启动服务后，可按实际监听端口登记。登记不会启动或重启进程。
              </p>
            </div>
            <Button size="sm" onClick={() => setRegisterOpen(true)}>
              登记服务
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {services.map((service) => (
              <button
                key={service.id}
                type="button"
                onClick={() => select(service.id)}
                className="rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-medium text-ink">{service.name}</span>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-[1px] text-[9px]",
                      service.status === "RUNNING"
                        ? "border-success/20 bg-success/10 text-success"
                        : "border-line bg-surface-2 text-ink-3",
                    )}
                  >
                    {statusLabel(service.status)}
                  </span>
                  <span className="ml-auto rounded bg-black/[.04] px-1 text-[9px] text-ink-3 dark:bg-white/[.07]">
                    临时
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-ink-3">
                  {service.endpoint.host}:{service.endpoint.port}
                </div>
                <div className="mt-0.5 text-[9.5px] text-ink-3">
                  终端 {service.terminalId.slice(-6)} · {timeLabel(service.createdAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <RegisterServiceDialog
        open={registerOpen}
        projectId={projectId}
        onClose={() => setRegisterOpen(false)}
        onRegistered={(id) => {
          setRegisterOpen(false);
          select(id);
        }}
      />
    </div>
  );
}

function ServiceDetail({
  id,
  onBack,
  onRefresh,
}: {
  id: string;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const detail = useQuery({
    queryKey: serviceKey(id),
    queryFn: () => readService(id),
    refetchInterval: 2000,
  });
  const logs = useQuery({
    queryKey: serviceLogsKey(id, 0),
    queryFn: () => readServiceLogs(id, 0),
    refetchInterval: 2000,
  });
  const [terminalError, setTerminalError] = useState("");
  const [action, setAction] = useState<"stop" | "delete" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const client = useQueryClient();
  const openWindow = useWindowStore((state) => state.open);
  const service = detail.data;
  if (detail.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-ink-3">
        <p role="alert">服务不可用或已移除。</p>
        <Button size="sm" variant="secondary" onClick={onBack}>
          返回列表
        </Button>
      </div>
    );
  }
  if (!service) return <div className="p-3 text-xs text-ink-3">读取服务…</div>;
  const ended = service.status !== "RUNNING";
  const logText = (logs.data?.chunks ?? []).map((chunk) => chunk.data).join("");
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-line px-3 py-2">
        <Button size="sm" variant="ghost" leading={<ArrowLeft size={12} />} onClick={onBack}>
          返回
        </Button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-semibold text-ink">{service.name}</span>
            <span
              className={cn(
                "rounded-full border px-1.5 py-[1px] text-[9px]",
                ended
                  ? "border-line bg-surface-2 text-ink-3"
                  : "border-success/20 bg-success/10 text-success",
              )}
            >
              {statusLabel(service.status)}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-ink-3">
            {`${service.endpoint.protocol}://${service.endpoint.host}:${service.endpoint.port}`}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            leading={<SquareTerminal size={12} />}
            onClick={() => {
              setTerminalError("");
              void readTerminal(service.terminalId)
                .then(openTerminal)
                .catch(() => setTerminalError("所属终端不可用"));
            }}
          >
            打开终端
          </Button>
          <Button
            size="sm"
            leading={<ExternalLink size={12} />}
            disabled={service.status !== "RUNNING"}
            onClick={() =>
              openWindow({
                kind: "browser",
                resourceId: `browser:${service.id}:/`,
                browser: { serviceId: service.id, path: "/" },
                title: `预览 ${service.name}`,
                projectId: service.projectId,
                source: "artifact",
              })
            }
          >
            预览
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={service.status !== "RUNNING" || actionBusy}
            onClick={() => {
              setActionError("");
              setAction("stop");
            }}
          >
            停止服务
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={actionBusy}
            onClick={() => {
              setActionError("");
              setAction("delete");
            }}
          >
            删除登记
          </Button>
        </div>
      </div>

      {ended ? (
        <div className="border-b border-line bg-surface-2/60 px-3 py-2 text-[11px] text-ink-3">
          服务已结束或暂不可用；登记与预览不会重新启动源进程。
        </div>
      ) : null}
      {terminalError ? (
        <p role="alert" className="px-3 py-2 text-[11px] text-danger">
          {terminalError}
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="px-3 py-2 text-[11px] text-danger">
          {actionError}
        </p>
      ) : null}
      <Dialog
        open={action !== null}
        onOpenChange={(value) => (!value && !actionBusy ? setAction(null) : undefined)}
      >
        <DialogContent className="w-[400px] space-y-3 text-sm">
          <DialogTitle>{action === "stop" ? "停止服务？" : "删除登记？"}</DialogTitle>
          <DialogDescription>
            {action === "stop"
              ? "会终止该监听进程及其子进程，并撤销预览；终端 Shell 和无关进程不受影响。共享同一进程的其他服务也会失效。"
              : "只删除登记并撤销预览，不会停止正在运行的进程；终端可继续使用。"}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={actionBusy} onClick={() => setAction(null)}>
              取消
            </Button>
            <Button
              variant={action === "stop" ? "danger" : "primary"}
              disabled={actionBusy}
              onClick={() => {
                if (!action) return;
                setActionBusy(true);
                setActionError("");
                void (action === "stop" ? stopService(service.id) : deleteService(service.id))
                  .then(async () => {
                    await client.invalidateQueries({ queryKey: servicesKey(service.projectId) });
                    setAction(null);
                    onBack();
                  })
                  .catch((cause: unknown) => {
                    setActionError(
                      cause instanceof Error
                        ? cause.message
                        : action === "stop"
                          ? "停止失败"
                          : "删除失败",
                    );
                  })
                  .finally(() => setActionBusy(false));
              }}
            >
              {action === "stop" ? "停止" : "删除"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="grid shrink-0 grid-cols-2 gap-2 px-3 py-2 md:grid-cols-4">
        <Info label="终端" value={service.terminalId.slice(-6)} mono />
        <Info label="执行" value={service.terminalExecutionId.slice(-6)} mono />
        <Info label="Generation" value={String(service.endpointGeneration)} mono />
        <Info label="登记时间" value={timeLabel(service.createdAt)} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
          关联终端输出
          <span className="font-normal normal-case tracking-normal text-ink-3">
            不是逐条命令的精确日志
          </span>
        </div>
        <div className="mt-1 min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-[#0f1115] p-2 font-mono text-[10px] leading-5 text-[#c7ccd4]">
          {logs.isError ? (
            <p role="alert" className="text-danger">
              日志读取失败
            </p>
          ) : logText ? (
            <pre className="whitespace-pre-wrap break-all">{logText}</pre>
          ) : (
            <span className="text-white/35">暂无输出</span>
          )}
        </div>
        <button
          type="button"
          className="mt-1 self-end text-[10px] text-ink-3 hover:text-ink"
          onClick={() => {
            onRefresh();
            void detail.refetch();
            void logs.refetch();
          }}
        >
          刷新
        </button>
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-[.08em] text-ink-3">{label}</div>
      <div className={cn("mt-0.5 truncate text-[11px] text-ink", mono && "font-mono")}>{value}</div>
    </div>
  );
}

function RegisterServiceDialog({
  open,
  projectId,
  onClose,
  onRegistered,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onRegistered: (id: string) => void;
}) {
  const client = useQueryClient();
  const terminals = useQuery({
    queryKey: ["terminals", "service-picker", projectId],
    queryFn: () => listTerminals(undefined, { projectId }),
    enabled: open,
  });
  const [terminalId, setTerminalId] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ id: string } | null>(null);
  const running = (terminals.data?.items ?? []).filter((item) => item.status === "RUNNING");

  const finish = async (serviceId: string) => {
    await client.invalidateQueries({ queryKey: servicesKey(projectId) });
    onRegistered(serviceId);
  };
  const submit = async () => {
    const parsedPort = Number(port);
    if (
      !terminalId ||
      !name.trim() ||
      !Number.isInteger(parsedPort) ||
      parsedPort < 1 ||
      parsedPort > 65535
    ) {
      setError("请选择运行中的终端，并填写 1–80 字名称与有效端口");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const action = await createServiceAction({
        kind: "temporary",
        terminalId,
        name: name.trim(),
        endpoint: { host: "127.0.0.1", port: parsedPort, protocol: "http" },
      });
      if (action.status === "WAITING_APPROVAL") {
        setPending({ id: action.id });
      } else if (action.status === "COMPLETED") {
        const id = serviceIdFrom(action.result);
        if (id) await finish(id);
        else setError("登记完成但缺少服务标识");
      } else {
        setError(`登记未完成：${action.status}`);
      }
    } catch (cause) {
      setError(registrationError(cause));
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    if (!pending) return;
    setBusy(true);
    setError("");
    try {
      const approved = await decideServiceAction(pending.id, "approve");
      const executed = await executeServiceAction(approved.id);
      const id = serviceIdFrom(executed.result);
      if (executed.status !== "COMPLETED" || !id) {
        setPending(null);
        setError(`登记未完成：${executed.status}，请重新登记。`);
        return;
      }
      await finish(id);
    } catch (cause) {
      if (closesAction(cause)) setPending(null);
      setError(registrationError(cause));
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await decideServiceAction(pending.id, "reject");
      setPending(null);
      onClose();
    } catch (cause) {
      if (closesAction(cause)) {
        setPending(null);
        setError(registrationError(cause));
        return;
      }
      setError(registrationError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(value) => (!value && !busy ? onClose() : undefined)}>
      <DialogContent className="w-[420px] space-y-3 text-sm">
        <DialogTitle>登记临时服务</DialogTitle>
        <DialogDescription>
          选择当前项目中运行服务的终端并填写服务的监听端口。后端会核验监听是否属于该终端。
        </DialogDescription>
        {pending ? (
          <div className="space-y-3">
            <p className="rounded-md border border-line bg-surface-2/60 p-2 text-[11px] text-ink-2">
              登记属于 L2 操作，需要审批。批准后会再次核验监听身份并登记。
            </p>
            {error ? (
              <p role="alert" className="text-[11px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void reject()}>
                拒绝
              </Button>
              <Button disabled={busy} onClick={() => void approve()}>
                批准并登记
              </Button>
            </div>
          </div>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-ink-2">运行中的终端</span>
              <select
                aria-label="选择终端"
                value={terminalId}
                onChange={(event) => setTerminalId(event.target.value)}
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-[12px]"
              >
                <option value="">选择终端</option>
                {running.map((terminal) => (
                  <option key={terminal.id} value={terminal.id}>
                    {terminal.title ?? terminal.role ?? terminal.id.slice(-6)} ·{" "}
                    {terminal.id.slice(-6)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-ink-2">服务名称</span>
              <input
                aria-label="服务名称"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如 web"
                className="w-full rounded border border-line bg-surface px-2 py-1.5 text-[12px]"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-ink-2">服务端口</span>
              <input
                aria-label="服务端口"
                value={port}
                inputMode="numeric"
                onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder="例如 5173"
                className="w-full rounded border border-line bg-surface px-2 py-1.5 font-mono text-[12px]"
              />
            </label>
            <p className="text-[10px] text-ink-3">
              填写所选终端中服务的实际监听端口。0.0.0.0 和 :: 等监听也可登记，无需改绑定或重启。
            </p>
            {error ? (
              <p role="alert" className="text-[11px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button disabled={busy} onClick={() => void submit()}>
                继续
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
