import {
  FileListResultSchema,
  FileReadResultSchema,
  FileSaveResultSchema,
  type FileScope,
  FileSearchResultSchema,
} from "@larness/shared";
import { ApiError, apiFetch } from "@/lib/api";
export function scopeId(scope: FileScope) {
  return "projectId" in scope
    ? `project:${scope.projectId}`
    : "sessionId" in scope
      ? `session:${scope.sessionId}`
      : "workspace:default";
}
export function fileKey(scope: FileScope, path: string) {
  return ["files", scopeId(scope), "content", path] as const;
}
export async function readFile(scope: FileScope, path: string) {
  return FileReadResultSchema.parse(
    await apiFetch(`/api/files?${new URLSearchParams({ ...scope, path })}`),
  );
}
export async function writeFile(
  scope: FileScope,
  path: string,
  content: string,
  expectedVersion: string,
) {
  return FileSaveResultSchema.parse(
    await apiFetch("/api/files", {
      method: "PUT",
      csrf: true,
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { scope, path, content, expectedVersion },
    }),
  );
}
function directoryUrl(scope: FileScope) {
  const [kind, id] = scopeId(scope).split(":");
  const resource = kind === "project" ? "projects" : kind === "session" ? "sessions" : "workspaces";
  return `/api/${resource}/${encodeURIComponent(id)}/files`;
}
export async function listDirectory(scope: FileScope, path: string, cursor?: string) {
  const params = new URLSearchParams({ path, ...(cursor ? { cursor } : {}) });
  return FileListResultSchema.parse(await apiFetch(`${directoryUrl(scope)}?${params}`));
}
export async function searchFiles(scope: FileScope, q: string, signal: AbortSignal) {
  return FileSearchResultSchema.parse(
    await apiFetch(`${directoryUrl(scope)}/search?${new URLSearchParams({ q })}`, { signal }),
  );
}
export function fileError(error: unknown): string {
  if (error instanceof ApiError) {
    if (["FILE_NOT_EDITABLE", "PAYLOAD_TOO_LARGE"].includes(error.code))
      return "不支持编辑：仅支持 512 KiB 以内的普通 UTF-8 文本。";
    if (error.code === "VERSION_CONFLICT") return "磁盘文件已变化，草稿已保留。";
    if (error.code === "RESOURCE_LOCKED") return "项目正在写入，请稍后重试；草稿已保留。";
    if (["NOT_FOUND", "FORBIDDEN", "PATH_OUTSIDE_PROJECT"].includes(error.code))
      return "文件不可用或已失去访问权限；本地草稿已保留。";
  }
  return "文件操作失败，请刷新后重试；本地草稿已保留。";
}
