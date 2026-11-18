import type { ProcessDto } from "@larness/shared";
import { Button, ConfirmDialog, cn, ErrorMessage, IconButton } from "@larness/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, RefreshCw, Server, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  listProcesses,
  processesKey,
  processKey,
  readProcess,
  readProcessOutput,
  stopProcess,
} from "@/features/processes/api";
import { operationError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import type { WindowTab } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";

function statusLabel(status: ProcessDto["status"]) {
  switch (status) {
    case "RUNNING":
      return "运行中";
    case "STARTING":
      return "启动中";
    case "STOPPING":
      return "停止中";
    case "STOPPED":
      return "已停止";
    case "FAILED":
      return "失败";
    default:
      return "已退出";
  }
}

function statusTone(status: ProcessDto["status"]) {
  return status === "RUNNING"
    ? "border-success/20 bg-success/10 text-success"
    : status === "FAILED"
      ? "border-danger/20 bg-danger/10 text-danger"
      : "border-line bg-surface-2 text-ink-3";
}

function MockServiceWindow({ tab }: { tab: WindowTab }) {
  const { data } = useSnapshot();
  const services = data.services.filter((service) => service.projectId === tab.projectId);
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Server size={14} className="text-ink-3" />
        <span className="text-[12px] font-semibold text-ink">服务</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3">
          {services.length}
        </span>
      </div>
      <div className="space-y-1 p-3">
        {services.length === 0 ? (
          <p className="text-[11px] text-ink-3">当前项目暂无后台服务</p>
        ) : (
          services.map((service) => (
            <div key={service.id} className="rounded-lg border border-line p-2 text-[11px]">
              {service.name}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function ServiceWindow({ tab }: { tab: WindowTab }) {
  if (USE_MOCKS) return <MockServiceWindow tab={tab} />;
  const projectId = tab.projectId;
  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-ink-3">
        选择一个项目后查看服务
      </div>
    );
  }
  return (
    <ProcessServiceWindow
      projectId={projectId}
      initialId={tab.resourceId.startsWith("prc_") ? tab.resourceId : null}
    />
  );
}

function ProcessServiceWindow({
  projectId,
  initialId,
}: {
  projectId: string;
  initialId: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: processesKey(projectId),
    queryFn: () => listProcesses(projectId),
    refetchInterval: 2_000,
  });
  if (selectedId) {
    return (
      <ProcessDetail
        id={selectedId}
        projectId={projectId}
        onBack={() => setSelectedId(null)}
        onStopped={() => {
          void queryClient.invalidateQueries({ queryKey: processesKey(projectId) });
          void queryClient.invalidateQueries({ queryKey: processKey(selectedId) });
        }}
      />
    );
  }
  const processes = query.data ?? [];
  const running = processes.filter((process) => process.status === "RUNNING").length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <Server size={14} className="text-ink-3" />
        <span className="text-[12px] font-semibold text-ink">服务</span>
        <span className="rounded-full bg-surface-2 px-1.5 text-[10px] text-ink-3">
          {running}/{processes.length}
        </span>
        <IconButton
          className="ml-auto h-6 w-6"
          label="刷新服务"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw size={12} className={query.isFetching ? "animate-spin" : undefined} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorMessage message={query.isError ? "服务读取失败，请刷新重试。" : null} />
        {processes.length === 0 && !query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Server size={22} className="text-ink-3" />
            <p className="text-[12px] font-medium text-ink">当前项目暂无后台服务</p>
            <p className="max-w-[340px] text-[11px] text-ink-3">
              让 Agent 启动开发服务器或 long-running 任务后，会自动出现在这里；不需要手动登记。
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {processes.map((process) => (
              <button
                key={process.id}
                type="button"
                onClick={() => setSelectedId(process.id)}
                className="rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-[12px] font-medium text-ink">
                    {process.name ?? process.executable}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-[1px] text-[9px]",
                      statusTone(process.status),
                    )}
                  >
                    {statusLabel(process.status)}
                  </span>
                  {process.previewEligible ? (
                    <span className="ml-auto rounded bg-accent-soft px-1 text-[9px] text-accent">
                      可预览
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-ink-3">
                  {process.port ? `127.0.0.1:${process.port}` : process.executable}
                </div>
                <div className="mt-0.5 truncate text-[9.5px] text-ink-3">
                  {process.pid ? `PID ${process.pid} · ` : ""}
                  {process.cwd}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProcessDetail({
  id,
  projectId,
  onBack,
  onStopped,
}: {
  id: string;
  projectId: string;
  onBack: () => void;
  onStopped: () => void;
}) {
  const queryClient = useQueryClient();
  const openWindow = useWindowStore((state) => state.open);
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [output, setOutput] = useState<string[]>([]);
  const appendedCursor = useRef(0);
  const processQuery = useQuery({
    queryKey: processKey(id),
    queryFn: () => readProcess(id),
    refetchInterval: 2_000,
  });
  const outputQuery = useQuery({
    queryKey: ["processes", "output", id, cursor],
    queryFn: () => readProcessOutput(id, cursor, 200),
    refetchInterval: 1_500,
  });
  useEffect(() => {
    const page = outputQuery.data;
    if (!page) return;
    const fresh = page.chunks.filter((chunk) => chunk.cursor > appendedCursor.current);
    if (fresh.length > 0) {
      appendedCursor.current = fresh[fresh.length - 1]?.cursor ?? appendedCursor.current;
      setOutput((current) => [...current, ...fresh.map((chunk) => chunk.data)].slice(-600));
    }
    if (page.nextCursor > cursor) setCursor(page.nextCursor);
  }, [outputQuery.data, cursor]);
  const process = processQuery.data;
  const stop = async () => {
    try {
      await stopProcess(id);
      setConfirmStop(false);
      setError(null);
      await queryClient.invalidateQueries({ queryKey: processKey(id) });
      await queryClient.invalidateQueries({ queryKey: ["processes"] });
      onStopped();
    } catch (cause) {
      setError(operationError(cause, "停止服务失败，请重试。"));
      setConfirmStop(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
        <IconButton className="h-6 w-6" label="返回服务列表" onClick={onBack}>
          <ArrowLeft size={13} />
        </IconButton>
        <span className="truncate text-[12px] font-semibold text-ink">
          {process?.name ?? "服务详情"}
        </span>
        {process ? (
          <span
            className={cn(
              "rounded-full border px-1.5 py-[1px] text-[9px]",
              statusTone(process.status),
            )}
          >
            {statusLabel(process.status)}
          </span>
        ) : null}
        {process?.previewEligible ? (
          <Button
            className="ml-auto"
            size="sm"
            variant="secondary"
            leading={<ExternalLink size={11} />}
            onClick={() =>
              openWindow({
                kind: "browser",
                resourceId: `browser:${process.id}:/`,
                browser: { serviceId: process.id, path: "/", targetKind: "process" },
                title: `预览 ${process.name ?? process.executable}`,
                projectId,
                source: "project",
              })
            }
          >
            预览
          </Button>
        ) : null}
        {process?.status === "RUNNING" || process?.status === "STARTING" ? (
          <Button
            className={process.previewEligible ? "" : "ml-auto"}
            size="sm"
            variant="secondary"
            leading={<Square size={11} />}
            onClick={() => setConfirmStop(true)}
          >
            停止
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <ErrorMessage message={error ?? (processQuery.isError ? "服务读取失败" : null)} />
        {process ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-ink-3">命令</dt>
            <dd className="truncate font-mono text-ink-2">{process.executable}</dd>
            <dt className="text-ink-3">目录</dt>
            <dd className="truncate font-mono text-ink-2">{process.cwd}</dd>
            <dt className="text-ink-3">端口</dt>
            <dd className="font-mono text-ink-2">
              {process.port ? `127.0.0.1:${process.port}` : "未声明"}
            </dd>
            <dt className="text-ink-3">PID</dt>
            <dd className="font-mono text-ink-2">{process.pid ?? "—"}</dd>
            <dt className="text-ink-3">开始</dt>
            <dd className="text-ink-2">
              {process.startedAt ? new Date(process.startedAt).toLocaleString("zh-CN") : "—"}
            </dd>
          </dl>
        ) : null}
        <pre
          role="log"
          aria-label="服务输出"
          className="mt-3 max-h-[calc(100dvh-16rem)] min-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-surface-2 p-2 font-mono text-[10.5px] text-ink-2"
        >
          {output.length > 0 ? output.join("") : "等待服务输出…"}
        </pre>
      </div>
      <ConfirmDialog
        open={confirmStop}
        title="停止服务？"
        description="将停止该任务及其进程组；未保存的临时状态会丢失。"
        confirmLabel="确认停止"
        danger
        onCancel={() => setConfirmStop(false)}
        onConfirm={() => void stop()}
      />
    </div>
  );
}
