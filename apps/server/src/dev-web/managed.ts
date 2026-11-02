import type { ChildProcess } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { DevWebAttachSchema, type DevWebTarget, devWebCache } from "./control.js";
import { webRoots } from "./paths.js";

export function managedWebFiles(serverRoot: string, target: DevWebTarget) {
  const webRoot = realpathSync(path.resolve(serverRoot, "../../apps/web"));
  return { webRoot, roots: [...webRoots(webRoot), realpathSync(devWebCache(target.generation))] };
}
export function receiveDevWebTarget(
  timeoutMs = 25_000,
  signal?: AbortSignal,
): Promise<DevWebTarget> {
  if (!process.send) return Promise.reject(new Error("开发转发需要受管控制通道"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("开发控制通道超时")), timeoutMs);
    const disconnect = () => finish(new Error("开发控制通道已关闭"));
    const abort = () => finish(new Error("启动已取消"));
    const message = (value: unknown) => {
      const parsed = DevWebAttachSchema.safeParse(value);
      if (!parsed.success) {
        finish(new Error("开发控制消息无效"));
        return;
      }
      const { type: _type, ...target } = parsed.data;
      finish(null, target);
    };
    const finish = (error: Error | null, target?: DevWebTarget) => {
      clearTimeout(timer);
      process.off("message", message);
      process.off("disconnect", disconnect);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (target) resolve(target);
    };
    process.once("message", message);
    process.once("disconnect", disconnect);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
export function waitChildMessage<T>(
  child: ChildProcess,
  parse: (message: unknown) => T | null,
  signal?: AbortSignal,
  phase: "Vite" | "Server" = "Server",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("开发子进程就绪超时")), 25_000);
    const fail = () =>
      finish(
        new Error(
          `${phase} 未就绪即退出 (code=${child.exitCode ?? "none"}, signal=${child.signalCode ?? "none"})`,
        ),
      );
    const abort = () => finish(new Error("启动已取消"));
    const message = (value: unknown) => {
      const parsed = parse(value);
      if (parsed === null) finish(new Error("开发子进程控制消息无效"));
      else finish(null, parsed);
    };
    const finish = (error: Error | null, value?: T) => {
      clearTimeout(timer);
      child.off("message", message);
      child.off("exit", fail);
      child.off("error", fail);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (value !== undefined) resolve(value);
    };
    child.on("message", message);
    child.once("exit", fail);
    child.once("error", fail);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
