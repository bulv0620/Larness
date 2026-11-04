export interface Project {
  id: string;
  name: string;
  rootPath: string;
  branch: string | null;
  git: boolean;
  accent: string;
}

export interface SessionSummary {
  workspaceKind?: "project" | "default" | "session";
  workspacePath?: string;
  id: string;
  projectId: string | null;
  title: string;
  status: "idle" | "running" | "waiting";
  updatedAt: number;
}

export interface ModelProfile {
  id: string;
  label: string;
  provider: "deepseek" | "glm" | "openai-compatible";
  model: string;
  detail: string;
  maxContextTokens?: number;
}

export interface ServiceInfo {
  id: string;
  projectId: string | null;
  name: string;
  port: number;
  status: "running" | "stopped" | "failed" | "deploying";
  runtime: "native" | "pm2";
  kind: "development" | "production";
  pid?: number;
  uptime?: string;
}

export interface TerminalInfo {
  id: string;
  projectId: string | null;
  title: string;
  cwd: string;
  port?: number;
  status: "running" | "exited";
}

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed";
  staged: boolean;
  additions: number;
  deletions: number;
}

export interface HostMetrics {
  cpuPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
}

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "directory";
  depth: number;
}

export interface FileDocument {
  path: string;
  language: string;
  content: string;
}

export interface ServiceLogLine {
  id: string;
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

export interface ArtifactSummary {
  id: string;
  title: string;
  description: string;
  meta: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  detail: string;
  tone: "info" | "warning" | "success";
}
