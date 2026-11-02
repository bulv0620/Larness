import { DevWebUnavailable, EntryConfigError } from "../dev-web/control.js";
import { IpcClientError } from "../ipc/client.js";

export function displayError(error: unknown): string {
  if (error instanceof EntryConfigError) return error.message;
  if (error instanceof DevWebUnavailable) return `${error.code}：${error.message}`;
  if (error instanceof IpcClientError) return `${error.code}：操作未完成，请刷新查看实际状态`;
  return "无法读取或校验数据，请刷新重试";
}
export function disconnected(error: unknown): boolean {
  return error instanceof IpcClientError && error.code === "CONNECTION_CLOSED";
}
