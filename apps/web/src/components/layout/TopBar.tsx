import {
  cn,
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
import {
  Bell,
  Cpu,
  Files,
  Globe2,
  MemoryStick,
  Monitor,
  Moon,
  PanelLeft,
  Server,
  SquareTerminal,
  Sun,
} from "lucide-react";
import { useTheme } from "@/app/ThemeProvider";
import { StatusDot } from "@/components/common/StatusDot";
import { useSession } from "@/features/auth/useAuth";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import { useLiveHost } from "@/lib/useLiveHost";
import { useMediaQuery } from "@/lib/useMediaQuery";
import type { WindowKind } from "@/lib/windowTypes";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { anyWindow, useWindowStore } from "@/stores/windowStore";

const launchers: Array<{
  kind: WindowKind;
  label: string;
  icon: typeof SquareTerminal;
  resourceId: string;
  title: string;
  projectId: string | null;
}> = [
  {
    kind: "terminal",
    label: "终端",
    icon: SquareTerminal,
    resourceId: "ter_1",
    title: "pnpm dev",
    projectId: "prj_larness",
  },
  {
    kind: "services",
    label: "服务",
    icon: Server,
    resourceId: "svc_web_dev",
    title: "web-dev",
    projectId: "prj_larness",
  },
  {
    kind: "browser",
    label: "浏览器",
    icon: Globe2,
    resourceId: "browser_preview",
    title: "localhost:5173",
    projectId: "prj_larness",
  },
  {
    kind: "files",
    label: "文件",
    icon: Files,
    resourceId: "apps/web/src/app/AppShell.tsx",
    title: "AppShell.tsx",
    projectId: "prj_larness",
  },
];

export function TopBar() {
  const { data } = useSnapshot();
  const session = useSession(!USE_MOCKS);
  const { theme, resolved, setTheme } = useTheme();
  const { projectId, toggleSidebar, setMobileSidebar } = useNavigationStore();
  const mobile = useMediaQuery("(max-width: 767px)");
  const { windows, open } = useWindowStore();
  const hasPendingApproval = useTimelineStore((state) =>
    state.items.some((item) => item.kind === "approval" && item.status === "pending"),
  );
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const metrics = useLiveHost(data.host);
  const project = data.projects.find((item) => item.id === projectId) ?? null;
  const ThemeIcon = theme === "system" ? Monitor : resolved === "dark" ? Moon : Sun;

  return (
    <header className="relative z-50 flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-2.5 backdrop-blur-xl">
      <IconButton
        label={mobile ? "打开导航" : "切换侧栏"}
        onClick={() => (mobile ? setMobileSidebar(true) : toggleSidebar())}
      >
        <PanelLeft size={15} />
      </IconButton>

      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[12.5px] font-semibold tracking-[-.01em]">
          {project?.name ?? "独立会话"}
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
        {session.data ? (
          <span className="ml-1 hidden rounded-full bg-surface-2 px-2 py-[2px] text-[10px] text-ink-2 sm:inline">
            {session.data.kind === "passkey" ? "可信设备 · Passkey" : "允许本次会话"}
          </span>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {USE_MOCKS ? (
          <div className="hidden items-center gap-0.5 rounded-xl border border-line bg-surface-2/70 p-0.5 lg:flex">
            {launchers.map((launcher) => {
              const Icon = launcher.icon;
              const active = Boolean(anyWindow(windows, launcher.kind));
              return (
                <Hint key={launcher.kind} label={`打开${launcher.label}窗口`}>
                  <button
                    type="button"
                    onClick={() => open({ ...launcher, source: "header" })}
                    aria-label={`打开${launcher.label}窗口`}
                    aria-pressed={active}
                    className={cn(
                      "flex h-7 items-center gap-1.5 rounded-[9px] px-2 text-[11px] font-medium transition-colors",
                      active
                        ? "bg-surface text-ink shadow-sm ring-1 ring-line"
                        : "text-ink-2 hover:bg-black/[.04] hover:text-ink dark:hover:bg-white/[.06]",
                    )}
                  >
                    <Icon size={13.5} strokeWidth={1.8} />
                    <span className="hidden xl:inline">{launcher.label}</span>
                  </button>
                </Hint>
              );
            })}
          </div>
        ) : null}

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
            <DropdownMenuSeparator />
            <div className="px-2.5 py-1.5 text-[11px] text-ink-3">窗口布局会按浏览器保存</div>
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
