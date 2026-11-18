import {
  ActiveTurnFlagSchema,
  type ModelProfile,
  type ServerEvent,
  type SessionSummary,
  WorkspaceKindSchema,
} from "@larness/shared";
import { apiFetch } from "./api";

export interface ApiProject {
  kind?: "project" | "default";
  id: string;
  name: string;
  rootPath: string;
  realPath: string;
  settings: {
    defaultModelProfileId: string | null;
    instructions: string;
    ignore: string[];
  };
  gitDetected: boolean;
  runningTerminals?: number;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface ApiSession {
  workspaceKind?: "project" | "default" | "session";
  id: string;
  projectId: string | null;
  workspacePath: string;
  title: string;
  status: "active" | "archived";
  modelProfileId: string | null;
  credentialProfileId?: string | null;
  model?: string | null;
  thinking?: string | null;
  agentProfile?: "coding" | "plan" | "service-ops";
  approvalPolicyId: "standard" | "strict" | "readonly" | "autonomous";
  createdAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export interface ApiTurn {
  id: string;
  sessionId: string;
  status: string;
  modelProfileId: string | null;
  credentialProfileId?: string | null;
  provider: string | null;
  model: string | null;
  thinking?: string | null;
  contextWindow?: number | null;
  input: { text: string; attachmentIds?: string[] };
  usage: unknown;
  error: unknown;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface ApiSessionDetail extends ApiSession {
  activeTurn: ApiTurn | null;
}

interface ApiSessionSummary extends ApiSession {
  hasActiveTurn?: boolean;
}

export interface EventPage {
  items: ServerEvent[];
  nextSeq: number;
  hasMore: boolean;
}

export interface CreateTurnResponse {
  turnId: string;
  status: string;
  sessionId: string;
}

export interface WorkspaceData {
  projects: ApiProject[];
  sessions: ApiSession[];
  models: ModelProfile[];
}

export interface ApiModelProfile {
  id: string;
  label: string;
  provider:
    | "deepseek"
    | "glm"
    | "openai-compatible"
    | "opencode-go"
    | "bailian"
    | "kimi"
    | "minimax";
  model: string;
  credentialProfileId: string | null;
  credentialLabel: string | null;
  endpoint: string | null;
  capabilities: {
    streaming: boolean;
    toolCalls: boolean;
    vision: boolean;
    reasoning: boolean;
    maxContextTokens: number;
  };
  createdAt: number;
}

export interface ApiCatalogThinkingLevel {
  id: string;
  label: string;
}

export interface ApiCatalogModel {
  id: string;
  label: string;
  contextWindow: number | null;
  capabilities?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    inputModalities?: string[];
    outputModalities?: string[];
    tools?: boolean;
    streaming?: boolean;
  };
  sources?: Record<string, string>;
  agentSelectable?: boolean;
  thinking: {
    supported: boolean;
    mode?: "toggle" | "levels" | "mandatory-levels" | "variants";
    defaultLevel?: string;
    reasoning?: boolean;
    levels: ApiCatalogThinkingLevel[];
  };
  default: boolean;
  visible?: boolean;
}

export interface ApiCatalogGroup {
  provider:
    | "deepseek"
    | "glm"
    | "openai-compatible"
    | "opencode-go"
    | "bailian"
    | "kimi"
    | "minimax";
  credentialProfileId: string;
  credentialLabel: string;
  billing?: "usage" | "subscription" | "unknown";
  candidatesOnly?: boolean;
  syncedAt: number | null;
  stale: boolean;
  lastRefreshError: string | null;
  models: ApiCatalogModel[];
}

export interface ModelSelection {
  model: string;
  thinking: string;
  credentialProfileId: string;
}

export interface ApiModelCatalog extends ApiCatalogGroup {
  groups: ApiCatalogGroup[];
  defaultSelection?: ModelSelection | null;
  directoryStatus?: "synced" | "unavailable";
}

export interface ApiCredential {
  id: string;
  provider:
    | "deepseek"
    | "glm"
    | "openai-compatible"
    | "opencode-go"
    | "bailian"
    | "kimi"
    | "minimax";
  label: string;
  secretRef: string;
  masked: string;
  presetId?: string | null;
  revision?: number;
  billing?: "usage" | "subscription" | "unknown";
  endpoint?: string | null;
  contextWindow?: number | null;
  createdAt: number;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  home: string;
  entries: Array<{ name: string; path: string }>;
  truncated: boolean;
  roots: Array<{ name: string; path: string }>;
}

export async function listDirectories(directory?: string): Promise<DirectoryListing> {
  const query = directory === undefined ? "" : `?path=${encodeURIComponent(directory)}`;
  return apiFetch<DirectoryListing>(`/api/fs/directories${query}`);
}

export async function listProjects(): Promise<ApiProject[]> {
  const response = await apiFetch<{ projects: ApiProject[] }>("/api/projects");
  return response.projects;
}

export async function createProject(input: {
  name?: string;
  rootPath: string;
}): Promise<ApiProject> {
  return apiFetch<ApiProject>("/api/projects", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export async function reorderProjects(projectIds: string[]): Promise<void> {
  await apiFetch("/api/projects/order", {
    method: "PUT",
    body: { projectIds },
    csrf: true,
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "DELETE",
    csrf: true,
  });
}

export async function getProject(id: string): Promise<ApiProject> {
  return apiFetch<ApiProject>(`/api/projects/${encodeURIComponent(id)}`);
}

export async function updateProject(
  id: string,
  input: { name?: string; settings?: { defaultModelProfileId?: string | null } },
): Promise<void> {
  await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    csrf: true,
  });
}

export async function listModels(): Promise<ApiModelProfile[]> {
  const response = await apiFetch<{ models: ApiModelProfile[] }>("/api/models");
  return response.models;
}

export async function listModelCatalog(): Promise<ApiModelCatalog> {
  return apiFetch<ApiModelCatalog>("/api/models/catalog");
}

export async function setModelDefault(input: {
  model: string;
  credentialProfileId: string;
  thinking?: string;
}): Promise<void> {
  await apiFetch("/api/models/default", {
    method: "PUT",
    body: input,
    csrf: true,
  });
}

export async function setModelVisibility(input: {
  credentialProfileId: string;
  modelId: string;
  visible: boolean;
}): Promise<void> {
  await apiFetch("/api/models/catalog/visibility", {
    method: "PATCH",
    body: input,
    csrf: true,
  });
}

export async function refreshModelCatalog(
  input: { credentialProfileId?: string; includePublicDirectory?: boolean } = {},
): Promise<ApiModelCatalog> {
  return apiFetch<ApiModelCatalog>("/api/models/catalog/refresh", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export interface ApiModelPreset {
  id: string;
  provider: ApiCredential["provider"];
  label: string;
  endpoint: string | null;
  billing: NonNullable<ApiCredential["billing"]>;
  fields?: ("endpoint" | "workspaceId")[];
}
export async function listModelPresets(): Promise<ApiModelPreset[]> {
  return (await apiFetch<{ presets: ApiModelPreset[] }>("/api/models/presets")).presets;
}

export interface ModelCapabilityOverride {
  contextWindow?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  thinking?: "off" | "toggle" | "levels" | "mandatory-levels";
  tools?: boolean;
  inputModalities?: string[];
  outputModalities?: string[];
  streaming?: boolean;
}
export async function setCapabilityOverride(
  credentialProfileId: string,
  modelId: string,
  override: ModelCapabilityOverride | null,
): Promise<void> {
  await apiFetch("/api/models/catalog/overrides", {
    method: override === null ? "DELETE" : "PUT",
    body: { credentialProfileId, modelId, ...(override === null ? {} : { override }) },
    csrf: true,
  });
}
export async function testModelConnection(id: string, model: string): Promise<void> {
  await apiFetch(`/api/credentials/${encodeURIComponent(id)}/test`, {
    method: "POST",
    body: { model },
    csrf: true,
  });
}

export async function listCredentials(): Promise<ApiCredential[]> {
  const response = await apiFetch<{ credentials: ApiCredential[] }>("/api/credentials");
  return response.credentials;
}

export async function createCredential(input: {
  provider?: ApiCredential["provider"];
  presetId?: string;
  workspaceId?: string;
  label: string;
  apiKey: string;
  endpoint?: string;
  contextWindow?: number;
}): Promise<ApiCredential> {
  return apiFetch<ApiCredential>("/api/credentials", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export async function updateCredentialEndpoint(id: string, endpoint: string | null): Promise<void> {
  await updateCredentialSettings(id, { endpoint });
}

export async function updateCredentialSettings(
  id: string,
  input: {
    endpoint?: string | null;
    contextWindow?: number | null;
    label?: string;
    apiKey?: string;
    revision?: number;
  },
): Promise<void> {
  await apiFetch(`/api/credentials/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    csrf: true,
  });
}

export async function deleteCredential(id: string): Promise<void> {
  await apiFetch(`/api/credentials/${encodeURIComponent(id)}`, {
    method: "DELETE",
    csrf: true,
  });
}

export async function listSessions(): Promise<ApiSessionSummary[]> {
  const response = await apiFetch<{ sessions: ApiSessionSummary[] }>("/api/sessions?limit=100");
  return response.sessions;
}

export async function createSession(input: {
  projectId?: string;
  title?: string;
  agentProfile?: "coding" | "plan" | "service-ops";
}): Promise<ApiSession> {
  return apiFetch<ApiSession>("/api/sessions", {
    method: "POST",
    body: input,
    csrf: true,
  });
}

export async function getSession(id: string): Promise<ApiSessionDetail> {
  return apiFetch<ApiSessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function updateSession(
  id: string,
  input: {
    title?: string;
    modelProfileId?: string | null;
    model?: string | null;
    thinking?: string | null;
    credentialProfileId?: string | null;
    agentProfile?: "coding" | "plan" | "service-ops";
    approvalPolicyId?: "standard" | "strict" | "readonly" | "autonomous";
  },
): Promise<ApiSession> {
  return apiFetch<ApiSession>(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: input,
    csrf: true,
  });
}

export async function archiveSession(id: string): Promise<void> {
  await apiFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
    csrf: true,
  });
}

export function screenshotUrl(sessionId: string, id: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`;
}

export async function uploadScreenshots(sessionId: string, files: File[]): Promise<string[]> {
  return Promise.all(
    files.map(async (file) => {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取截图失败"));
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result.slice(reader.result.indexOf(",") + 1))
            : reject(new Error("读取截图失败"));
        reader.readAsDataURL(file);
      });
      const result = await apiFetch<{ id: string }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
        {
          method: "POST",
          csrf: true,
          body: { mime: file.type, data },
        },
      );
      return result.id;
    }),
  );
}

export async function createTurn(
  sessionId: string,
  input: {
    input: string;
    attachmentIds?: string[];
    model?: string;
    thinking?: string;
    credentialProfileId?: string;
    modelProfileId?: string;
  },
  idempotencyKey: string,
): Promise<CreateTurnResponse> {
  return apiFetch<CreateTurnResponse>(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
    method: "POST",
    body: input,
    csrf: true,
    headers: { "idempotency-key": idempotencyKey },
  });
}

export async function cancelTurn(turnId: string): Promise<{ turnId: string; status: string }> {
  return apiFetch(`/api/turns/${encodeURIComponent(turnId)}/cancel`, {
    method: "POST",
    body: {},
    csrf: true,
  });
}

export interface ResumeTurnResponse {
  turnId: string;
  status: string;
  sessionId: string;
  resumedFromTurnId: string;
}

export async function resumeTurn(turnId: string): Promise<ResumeTurnResponse> {
  return apiFetch<ResumeTurnResponse>(`/api/turns/${encodeURIComponent(turnId)}/resume`, {
    method: "POST",
    body: {},
    csrf: true,
  });
}

export async function fetchEvents(sessionId: string, after = 0, limit = 200): Promise<EventPage> {
  return apiFetch<EventPage>(
    `/api/sessions/${encodeURIComponent(sessionId)}/events?after=${after}&limit=${limit}`,
  );
}

export async function fetchAllEvents(
  sessionId: string,
  after = 0,
  limit = 200,
): Promise<ServerEvent[]> {
  const collected: ServerEvent[] = [];
  let cursor = after;

  for (;;) {
    const page = await fetchEvents(sessionId, cursor, limit);
    collected.push(...page.items);
    cursor = page.nextSeq;

    if (!page.hasMore) {
      return collected;
    }
  }
}

export async function decideApproval(
  approvalId: string,
  decision: "approve" | "reject",
): Promise<void> {
  await apiFetch(`/api/approvals/${encodeURIComponent(approvalId)}`, {
    method: "POST",
    body: { decision },
    csrf: true,
  });
}

export function toProjectView(project: ApiProject) {
  const accents = ["#0A84FF", "#FF9F0A", "#30D158", "#BF5AF2", "#64D2FF"];
  const index = Array.from(project.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return {
    id: project.id,
    kind: project.kind,
    name: project.name,
    rootPath: project.realPath,
    branch: null,
    git: project.gitDetected,
    runningTerminals: project.runningTerminals ?? 0,
    accent: accents[index % accents.length] ?? accents[0],
  };
}

export function toModelProfileView(model: ApiModelProfile): ModelProfile {
  return {
    id: model.id,
    label: model.label,
    provider: model.provider === "openai-compatible" ? "openai-compatible" : "deepseek",
    model: model.model,
    detail: `${Math.round(model.capabilities.maxContextTokens / 1000)}K 上下文 · 工具调用`,
    maxContextTokens: model.capabilities.maxContextTokens,
  };
}

export function toSessionView(session: ApiSessionSummary): SessionSummary {
  return {
    workspaceKind: WorkspaceKindSchema.parse(
      session.workspaceKind ?? (session.projectId ? "project" : "session"),
    ),
    workspacePath: session.workspacePath,
    id: session.id,
    projectId: session.projectId,
    title: session.title,
    status: ActiveTurnFlagSchema.parse(session.hasActiveTurn) ? "running" : "idle",
    updatedAt: session.updatedAt,
  };
}
