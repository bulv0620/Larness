import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  IconButton,
} from "@larness/ui";
import { Bell, Cpu, MemoryStick, Monitor, Moon, PanelLeft, Sun } from "lucide-react";
import { useTheme } from "@/app/ThemeProvider";
import { StatusDot } from "@/components/common/StatusDot";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useLiveHost } from "@/lib/useLiveHost";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { unassignedWorkspaceLabel } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

export function TopBar({ version }: { version?: string }) {
  const { data } = useSnapshot();
  const { theme, resolved, setTheme } = useTheme();
  const { projectId, sessionId, toggleSidebar, setMobileSidebar } = useNavigationStore();
  const mobile = useMediaQuery("(max-width: 767px)");
  const hasPendingApproval = useTimelineStore((state) =>
    state.items.some((item) => item.kind === "approval" && item.status === "pending"),
  );
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const metrics = useLiveHost(data.host);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const ThemeIcon = theme === "system" ? Monitor : resolved === "dark" ? Moon : Sun;
  const versionLabel =
    typeof version === "string" &&
    version !== "0.0.0" &&
    /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)
      ? `v${version}`
      : "版本未知";

  return (
    <header className="relative z-50 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-2.5 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-br from-[#3d9bff] to-[#0066d6] text-[11px] font-bold text-white shadow-sm">
          L
        </div>
        <span className="shrink-0 text-[12.5px] font-semibold tracking-[-.01em]">Larness</span>
        <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-[1px] font-mono text-[9px] text-ink-3">
          {versionLabel}
        </span>
      </div>

      <IconButton
        label={mobile ? "打开导航" : "切换侧栏"}
        onClick={() => (mobile ? setMobileSidebar(true) : toggleSidebar())}
      >
        <PanelLeft size={15} />
      </IconButton>

      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-line" />

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[12.5px] font-semibold tracking-[-.01em]">
          {project?.name ?? unassignedWorkspaceLabel(sessionId, data.sessions)}
        </span>
        <span className="text-ink-3">/</span>
        <span className="flex items-center gap-1.5">
          <StatusDot tone={isStreaming ? "running" : "idle"} pulse={isStreaming} />
          <span className="text-[11px] text-ink-2">{isStreaming ? "Agent 运行中" : "空闲"}</span>
        </span>
        {project?.branch ? (
          <span className="ml-1 hidden items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-[2px] font-mono text-[10px] text-ink-2 md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent/70" />
            {project.branch}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {USE_MOCKS ? (
          <div className="mx-1 hidden items-center gap-3 rounded-xl border border-line bg-surface-2/60 px-2.5 py-1 xl:flex">
            <Hint label="Larness 主机 CPU 使用率">
              <span className="flex items-center gap-1.5">
                <Cpu size={12} className="text-ink-3" />
                <span className="h-1 w-10 overflow-hidden rounded-full bg-black/[.08] dark:bg-white/[.1]">
                  <span
                    className="block h-full rounded-full bg-accent transition-[width] duration-700"
                    style={{ width: `${metrics.cpuPercent}%` }}
                  />
                </span>
                <span className="w-7 font-mono text-[10px] text-ink-2">
                  {Math.round(metrics.cpuPercent)}%
                </span>
              </span>
            </Hint>
            <span className="h-3 w-px bg-line" />
            <Hint label="Larness 主机内存占用">
              <span className="flex items-center gap-1.5">
                <MemoryStick size={12} className="text-ink-3" />
                <span className="font-mono text-[10px] text-ink-2">
                  {metrics.memoryUsedGb.toFixed(1)} / {metrics.memoryTotalGb} GB
                </span>
              </span>
            </Hint>
          </div>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="外观与主题">
              <ThemeIcon size={15} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>外观</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as "light" | "dark" | "system")}
            >
              <DropdownMenuRadioItem value="light">
                <Sun size={13} /> 浅色
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon size={13} /> 深色
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="system">
                <Monitor size={13} /> 跟随系统
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="通知" className="relative">
              <Bell size={15} />
              {hasPendingApproval ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-surface" />
              ) : null}
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[280px]">
            <DropdownMenuLabel>通知</DropdownMenuLabel>
            {hasPendingApproval ? (
              <DropdownMenuItem className="items-start gap-2 py-2">
                <StatusDot tone="waiting" className="mt-1" />
                <span>
                  <span className="block text-[12px] font-medium text-ink">部署待批准</span>
                  <span className="mt-0.5 block text-[11px] text-ink-3">
                    web-prod 计划切换到 c0f3a2d，等待你的批准。
                  </span>
                </span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>暂无新通知</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <span className="text-[11px] text-ink-3">通知仅保留在当前设备</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
