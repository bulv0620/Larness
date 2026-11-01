import { Button, cn, IconButton, Tabs, TabsContent, TabsList, TabsTrigger } from "@harness/ui";
import { ExternalLink, Play, RotateCw, Square, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { StatusDot } from "@/components/common/StatusDot";
import { useSnapshot } from "@/lib/queries";
import type { WindowTab } from "@/lib/windowTypes";
import { serviceLogs } from "@/mocks/fixtures";
import { useWindowStore } from "@/stores/windowStore";

export function ServiceWindow({ tab }: { tab: WindowTab }) {
  const { data } = useSnapshot();
  const service = data.services.find((item) => item.id === tab.resourceId) ?? data.services[0];
  const open = useWindowStore((state) => state.open);
  const [running, setRunning] = useState(service?.status === "running");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRunning(service?.status === "running");
  }, [service?.status]);

  const restart = () => {
    if (busy) return;
    setBusy(true);
    setRunning(false);
    window.setTimeout(() => {
      setRunning(true);
      setBusy(false);
    }, 900);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <SquareTerminal size={16} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-semibold text-ink">{service?.name}</span>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-1.5 py-[1px] text-[9px] font-medium",
                running
                  ? "border-success/20 bg-success/10 text-success"
                  : "border-line bg-surface-2 text-ink-3",
              )}
            >
              <StatusDot tone={running ? "running" : "idle"} pulse={running} />
              {busy ? "重启中" : running ? "运行中" : "已停止"}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[9.5px] text-ink-3">
            {service?.runtime} · :{service?.port} ·{" "}
            {service?.kind === "production" ? "生产" : "开发"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            leading={<ExternalLink size={11} />}
            onClick={() =>
              open({
                kind: "browser",
                resourceId: `http://localhost:${service?.port ?? 5173}/`,
                title: `localhost:${service?.port ?? 5173}`,
                projectId: service?.projectId ?? null,
                source: "artifact",
              })
            }
          >
            预览
          </Button>
          <IconButton label="重启服务" onClick={restart} disabled={busy}>
            <RotateCw size={13} className={busy ? "animate-spin" : undefined} />
          </IconButton>
          <IconButton label="停止服务" tone="danger">
            <Square size={12} fill="currentColor" />
          </IconButton>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 pt-2">
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="logs">日志</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            <Info label="端口" value={`:${service?.port ?? "—"}`} mono />
            <Info label="PID" value={running ? String(service?.pid ?? "—") : "—"} mono />
            <Info label="运行时" value={service?.runtime ?? "—"} />
            <Info label="已运行" value={running ? (service?.uptime ?? "刚刚") : "—"} />
          </div>

          <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
              <Play size={12} className="text-success" />
              健康检查
              <span className="ml-auto font-mono text-[9.5px] text-success">HTTP 200 · 42ms</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[.06] dark:bg-white/[.08]">
              <div className="h-full w-full rounded-full bg-success/70" />
            </div>
            <div className="mt-1.5 text-[9.5px] text-ink-3">最近 5 分钟 12 次检查通过 · 无重启</div>
          </div>

          <div className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-ink-3">
              启动命令
            </div>
            <pre className="mt-1.5 overflow-auto rounded-lg bg-[#1d1d1f] px-2.5 py-2 font-mono text-[10px] text-[#d7dae0]">
              pnpm --filter @harness/web {service?.kind === "production" ? "start" : "dev"}
            </pre>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="min-h-0 flex-1 overflow-auto p-3">
          <div className="rounded-xl border border-line bg-[#0f1115] p-2.5 font-mono text-[10px] leading-5">
            {serviceLogs.map((line) => (
              <div key={line.id} className="flex gap-2">
                <span className="shrink-0 text-white/30">{line.timestamp}</span>
                <span
                  className={cn(
                    "w-8 shrink-0 uppercase",
                    line.level === "warn"
                      ? "text-[#f7c948]"
                      : line.level === "error"
                        ? "text-[#ff6b6b]"
                        : "text-[#5dd39e]",
                  )}
                >
                  {line.level}
                </span>
                <span className={line.level === "warn" ? "text-[#f7c948]/90" : "text-[#c7ccd4]"}>
                  {line.message}
                </span>
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1 text-white/35">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              watching…
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-2.5">
      <div className="text-[9.5px] uppercase tracking-[.08em] text-ink-3">{label}</div>
      <div className={cn("mt-1 text-[12px] font-medium text-ink", mono && "font-mono")}>
        {value}
      </div>
    </div>
  );
}
