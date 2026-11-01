import type {
  ApprovalItem,
  FileDocument,
  FileNode,
  GatewaySnapshot,
  GitFileChange,
  MessageItem,
  PlanItem,
  Project,
  ServiceLogLine,
  SessionSummary,
  TimelineItem,
  ToolItem,
} from "@larness/shared";

const now = Date.now();
const minutes = (n: number) => n * 60_000;

export const projects: Project[] = [
  {
    id: "prj_larness",
    name: "larness-web",
    rootPath: "/Users/bulv/Desktop/Larness",
    branch: "feat/agent-runtime",
    git: true,
    accent: "#0A84FF",
  },
  {
    id: "prj_docs",
    name: "docs-site",
    rootPath: "/Users/bulv/Desktop/docs-site",
    branch: null,
    git: false,
    accent: "#FF9F0A",
  },
];

export const sessions: SessionSummary[] = [
  {
    id: "ses_1",
    projectId: "prj_larness",
    title: "实现 Agent 工具调用审批",
    status: "running",
    updatedAt: now - minutes(2),
  },
  {
    id: "ses_2",
    projectId: "prj_larness",
    title: "修复终端重连时的 Tab 状态",
    status: "idle",
    updatedAt: now - minutes(48),
  },
  {
    id: "ses_3",
    projectId: "prj_docs",
    title: "整理文档站首页导航",
    status: "idle",
    updatedAt: now - minutes(95),
  },
  {
    id: "ses_4",
    projectId: null,
    title: "调研 DeepSeek 流式工具调用",
    status: "idle",
    updatedAt: now - minutes(26),
  },
  {
    id: "ses_5",
    projectId: null,
    title: "整理本周部署记录",
    status: "idle",
    updatedAt: now - minutes(180),
  },
];

export const models = [
  {
    id: "mdl_deepseek_chat",
    label: "DeepSeek V3.2",
    provider: "deepseek" as const,
    model: "deepseek-chat",
    detail: "128K 上下文 · 工具调用",
    maxContextTokens: 128_000,
  },
  {
    id: "mdl_deepseek_reasoner",
    label: "DeepSeek R1",
    provider: "deepseek" as const,
    model: "deepseek-reasoner",
    detail: "推理模式 · 64K 上下文",
    maxContextTokens: 64_000,
  },
  {
    id: "mdl_glm",
    label: "GLM-4.6",
    provider: "glm" as const,
    model: "glm-4.6",
    detail: "200K 上下文 · 工具调用",
    maxContextTokens: 200_000,
  },
];

export const services = [
  {
    id: "svc_web_dev",
    projectId: "prj_larness",
    name: "web-dev",
    port: 5173,
    status: "running" as const,
    runtime: "native" as const,
    kind: "development" as const,
    pid: 48213,
    uptime: "2h 14m",
  },
  {
    id: "svc_api_dev",
    projectId: "prj_larness",
    name: "api-dev",
    port: 3001,
    status: "running" as const,
    runtime: "native" as const,
    kind: "development" as const,
    pid: 48277,
    uptime: "1h 52m",
  },
  {
    id: "svc_web_prod",
    projectId: "prj_larness",
    name: "web-prod",
    port: 8080,
    status: "stopped" as const,
    runtime: "pm2" as const,
    kind: "production" as const,
  },
  {
    id: "svc_docs_dev",
    projectId: "prj_docs",
    name: "docs-dev",
    port: 4321,
    status: "running" as const,
    runtime: "native" as const,
    kind: "development" as const,
    pid: 48311,
    uptime: "38m",
  },
];

export const terminals = [
  {
    id: "ter_1",
    projectId: "prj_larness",
    title: "pnpm dev",
    cwd: "/Users/bulv/Desktop/Larness",
    port: 5173,
    status: "running" as const,
  },
  {
    id: "ter_2",
    projectId: null,
    title: "zsh",
    cwd: "~",
    status: "running" as const,
  },
  {
    id: "ter_3",
    projectId: "prj_docs",
    title: "pnpm docs:dev",
    cwd: "/Users/bulv/Desktop/docs-site",
    port: 4321,
    status: "running" as const,
  },
];

export const gitChanges: GitFileChange[] = [
  {
    path: "apps/web/src/app/AppShell.tsx",
    status: "modified",
    staged: false,
    additions: 42,
    deletions: 8,
  },
  {
    path: "apps/web/src/features/chat/Composer.tsx",
    status: "modified",
    staged: false,
    additions: 18,
    deletions: 3,
  },
  {
    path: "packages/shared/src/events.ts",
    status: "modified",
    staged: true,
    additions: 9,
    deletions: 0,
  },
  {
    path: "docs/architecture/overview.md",
    status: "modified",
    staged: true,
    additions: 6,
    deletions: 1,
  },
  {
    path: "apps/web/src/components/windows/WindowLayer.tsx",
    status: "added",
    staged: false,
    additions: 74,
    deletions: 0,
  },
];

export const host = {
  cpuPercent: 38,
  memoryUsedGb: 9.6,
  memoryTotalGb: 16,
};

export const fileTree: FileNode[] = [
  { path: "apps", name: "apps", type: "directory", depth: 0 },
  { path: "apps/web", name: "web", type: "directory", depth: 1 },
  { path: "apps/web/src", name: "src", type: "directory", depth: 2 },
  { path: "apps/web/src/app", name: "app", type: "directory", depth: 3 },
  { path: "apps/web/src/app/AppShell.tsx", name: "AppShell.tsx", type: "file", depth: 4 },
  { path: "apps/web/src/app/ThemeProvider.tsx", name: "ThemeProvider.tsx", type: "file", depth: 4 },
  { path: "apps/web/src/features", name: "features", type: "directory", depth: 3 },
  { path: "apps/web/src/features/chat", name: "chat", type: "directory", depth: 4 },
  { path: "apps/web/src/features/chat/Composer.tsx", name: "Composer.tsx", type: "file", depth: 5 },
  { path: "apps/web/src/features/chat/Timeline.tsx", name: "Timeline.tsx", type: "file", depth: 5 },
  { path: "apps/web/src/mocks", name: "mocks", type: "directory", depth: 3 },
  { path: "apps/web/src/mocks/fixtures.ts", name: "fixtures.ts", type: "file", depth: 4 },
  { path: "apps/web/src/styles", name: "styles", type: "directory", depth: 3 },
  { path: "apps/web/src/styles/tokens.css", name: "tokens.css", type: "file", depth: 4 },
  { path: "packages", name: "packages", type: "directory", depth: 0 },
  { path: "packages/shared", name: "shared", type: "directory", depth: 1 },
  { path: "packages/shared/src/events.ts", name: "events.ts", type: "file", depth: 2 },
  { path: "docs", name: "docs", type: "directory", depth: 0 },
  { path: "docs/architecture", name: "architecture", type: "directory", depth: 1 },
  { path: "docs/architecture/overview.md", name: "overview.md", type: "file", depth: 2 },
  { path: "package.json", name: "package.json", type: "file", depth: 0 },
  { path: "README.md", name: "README.md", type: "file", depth: 0 },
];

const appShell = `import { ConversationWorkspace } from "@/features/chat/ConversationWorkspace";
import { ProjectSidebar } from "@/components/layout/ProjectSidebar";
import { ProjectResourceSidebar } from "@/components/layout/ProjectResourceSidebar";
import { TopBar } from "@/components/layout/TopBar";
import { WindowLayer } from "@/components/windows/WindowLayer";

export function AppShell() {
  return (
    <div className="flex h-screen flex-col bg-canvas text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ProjectSidebar />
        <ConversationWorkspace />
        <ProjectResourceSidebar />
      </div>
      <WindowLayer />
    </div>
  );
}
`;

const composer = `export function Composer() {
  const [value, setValue] = useState("");
  const streaming = useMockTimeline((state) => state.isStreaming);

  return (
    <div className="composer-shell">
      <textarea
        value={value}
        placeholder="描述任务，或粘贴日志 / 截图…"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void send(value);
          }
        }}
      />
      <ComposerToolbar />
    </div>
  );
}
`;

const packageJson = `{
  "name": "larness",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @larness/web dev",
    "build": "pnpm --filter @larness/web build",
    "check": "biome ci . && pnpm typecheck && pnpm test"
  }
}
`;

const readme = `# Larness

单机、单工作空间、AI-first 的 Web IDE 与本机服务运维工作空间。

## 当前状态

Spec 工程已初始化，开始构建 S0 视觉 Demo。

- 三栏工作台 + 顶部工具入口
- 文件 / 服务 / 终端 / Git 资源分区
- 可拖动、缩放、置顶的全局窗口层
`;

const overview = `# 系统架构总览

Larness 是运行在单台主机上的单工作空间 AI-first Web IDE。

## 进程边界

- Server：Fastify、WebSocket、SQLite、Agent Runtime
- TUI：本机初始化、设备审批、设备撤销
- Web：三栏工作台、窗口层、事件订阅

所有资源操作经过后端授权，前端隐藏不构成授权。
`;

export const fileContents: Record<string, FileDocument> = {
  "apps/web/src/app/AppShell.tsx": {
    path: "apps/web/src/app/AppShell.tsx",
    language: "typescript",
    content: appShell,
  },
  "apps/web/src/features/chat/Composer.tsx": {
    path: "apps/web/src/features/chat/Composer.tsx",
    language: "typescript",
    content: composer,
  },
  "package.json": { path: "package.json", language: "json", content: packageJson },
  "README.md": { path: "README.md", language: "markdown", content: readme },
  "docs/architecture/overview.md": {
    path: "docs/architecture/overview.md",
    language: "markdown",
    content: overview,
  },
};

export const serviceLogs: ServiceLogLine[] = [
  { id: "log_1", level: "info", message: "VITE v7.1.7  ready in 412 ms", timestamp: "20:41:12" },
  {
    id: "log_2",
    level: "info",
    message: "➜  Local:   http://localhost:5173/",
    timestamp: "20:41:12",
  },
  { id: "log_3", level: "info", message: "➜  press h + enter to show help", timestamp: "20:41:12" },
  {
    id: "log_4",
    level: "info",
    message: "hmr update /src/app/AppShell.tsx",
    timestamp: "20:42:03",
  },
  {
    id: "log_5",
    level: "warn",
    message: "Sourcemap for /src/mocks/fixtures.ts points to missing file",
    timestamp: "20:43:18",
  },
  {
    id: "log_6",
    level: "info",
    message: "hmr update /src/styles/tokens.css",
    timestamp: "20:44:26",
  },
];

export const diffLines = [
  { type: "context", text: '  const [value, setValue] = useState("");' },
  { type: "remove", text: "- const streaming = useMockTimeline((state) => state.isStreaming);" },
  { type: "add", text: "+ const streaming = useMockTimeline((state) => state.isStreaming);" },
  { type: "add", text: "+ const focusNonce = useNavigation((state) => state.focusComposerNonce);" },
  { type: "context", text: "" },
  { type: "context", text: "  return (" },
  { type: "remove", text: '-   <div className="composer">' },
  { type: "add", text: '+   <div className="composer-shell">' },
  { type: "context", text: "      <textarea" },
  { type: "add", text: "+       data-focus={focusNonce}" },
  { type: "context", text: "        value={value}" },
  { type: "context", text: '        placeholder="描述任务，或粘贴日志 / 截图…"' },
  { type: "context", text: "      />" },
  { type: "context", text: "    </div>" },
  { type: "context", text: "  );" },
];

const userMessage: MessageItem = {
  id: "msg_u_1",
  kind: "message",
  role: "user",
  text: "把首页改成三栏工作台，然后构建并部署到生产服务。",
  createdAt: now - minutes(6),
};

const assistantMessage: MessageItem = {
  id: "msg_a_1",
  kind: "message",
  role: "assistant",
  text: "我先检查项目结构、构建脚本和现有端口，再把首页替换为三栏布局。构建完成后会给出部署计划，等你确认后才会切换生产服务。",
  createdAt: now - minutes(5),
};

const plan: PlanItem = {
  id: "plan_1",
  kind: "plan",
  title: "执行计划",
  createdAt: now - minutes(5),
  steps: [
    { id: "step_1", title: "检查项目结构与构建脚本", status: "done" },
    { id: "step_2", title: "实现三栏工作台与窗口层", status: "done", detail: "12 个文件" },
    { id: "step_3", title: "构建 web 并验证产物", status: "done" },
    { id: "step_4", title: "部署 web-prod 到 8080", status: "pending", detail: "等待你的批准" },
  ],
};

const readTool: ToolItem = {
  id: "tool_1",
  kind: "tool",
  name: "read_file",
  summary: "读取 package.json 与 vite.config.ts",
  args: '{ "paths": ["package.json", "apps/web/vite.config.ts"] }',
  status: "done",
  output: "2 个文件 · 1.8 KB · 发现 build / preview 脚本",
  durationMs: 84,
  createdAt: now - minutes(5),
};

const buildTool: ToolItem = {
  id: "tool_2",
  kind: "tool",
  name: "run_command",
  summary: "pnpm --filter @larness/web build",
  args: '{ "command": "pnpm --filter @larness/web build", "cwd": "." }',
  status: "done",
  output:
    "vite v7.1.7 building for production…\n✓ 1842 modules transformed\ndist/assets/index-8f2a1c.js  412.8 kB │ gzip: 126.4 kB\n✓ built in 3.42s",
  durationMs: 3421,
  createdAt: now - minutes(4),
};

const approval: ApprovalItem = {
  id: "appr_1",
  kind: "approval",
  serviceName: "web-prod",
  port: 8080,
  version: "c0f3a2d · build 2026-10-31 20:44",
  impact: "替换当前停止中的生产服务；健康检查通过后写入部署记录。",
  status: "pending",
  createdAt: now - minutes(3),
};

export const initialTimeline: TimelineItem[] = [
  userMessage,
  assistantMessage,
  plan,
  readTool,
  buildTool,
  approval,
];

export const snapshot: GatewaySnapshot = {
  projects,
  sessions,
  models,
  host,
  services,
  terminals,
  gitChanges,
};
