import {
  FileNotificationSchema,
  type FileScope,
  FileSubscribeAckSchema,
  FileWatchErrorSchema,
  ResourceReplaySchema,
} from "@larness/shared";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { scopeId } from "./api";

export function useFileWatch(scope: FileScope, paths: string[]) {
  const id = scopeId(scope);
  const signature = JSON.stringify([...new Set(paths)].sort());
  const [status, setStatus] = useState("正在连接文件监听…");
  useEffect(() => {
    const allPaths: string[] = JSON.parse(signature);
    if (!allPaths.length) return;
    let disposed = false,
      sequence = 0,
      delay = 1000;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let replaying = false;
    const streamId = `file:${id}`;
    const invalidate = () => {
      if (!disposed) void queryClient.invalidateQueries({ queryKey: ["files", id] });
    };
    const replay = async () => {
      if (replaying || disposed) return;
      replaying = true;
      try {
        // Notifications invalidate snapshots; pagination is only for closing the durable sequence gap.
        for (let page = 0; page < 10 && !disposed; page++) {
          const result = ResourceReplaySchema.parse(
            await apiFetch(
              `/api/resource-events?${new URLSearchParams({ streamId, after: String(sequence), limit: "500" })}`,
            ),
          );
          if (disposed) return;
          if (result.resyncRequired || !result.items.length) {
            sequence = result.currentSequence;
            break;
          }
          sequence = Math.max(sequence, result.items.at(-1)?.sequence ?? sequence);
          if (sequence >= result.currentSequence) break;
          // Very long histories need a snapshot, not an unbounded browser replay loop.
          if (page === 9) sequence = result.currentSequence;
        }
      } catch {
        if (!disposed) setStatus("监听恢复失败，请手动刷新。");
      } finally {
        replaying = false;
        invalidate();
      }
    };
    const connect = () => {
      if (disposed) return;
      const url = new URL("/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () =>
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [
              { topic: "file", resourceId: id, paths: allPaths.slice(0, 128), after: sequence },
            ],
          }),
        );
      socket.onmessage = (message) => {
        if (disposed) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(message.data));
        } catch {
          setStatus("文件监听响应无效，请刷新。");
          return;
        }
        const ack = FileSubscribeAckSchema.safeParse(raw);
        if (ack.success && ack.data.subscription.resourceId === id) {
          delay = 1000;
          setStatus(
            ack.data.partial || allPaths.length > 128
              ? "部分监听，请按需手动刷新。"
              : "文件监听已连接",
          );
          void replay();
          invalidate();
          return;
        }
        if (FileWatchErrorSchema.safeParse(raw).success) {
          setStatus("文件监听不可用，请手动刷新。");
          return;
        }
        const event = FileNotificationSchema.safeParse(raw);
        if (!event.success || event.data.streamId !== streamId) return;
        if (event.data.sequence <= sequence) return;
        if (event.data.sequence !== sequence + 1) void replay();
        else sequence = event.data.sequence;
        if (event.data.type === "file.resync.required")
          setStatus(
            event.data.payload.reasonCode === "RECOVERED"
              ? "文件监听已连接"
              : "监听已降级，请手动刷新。",
          );
        invalidate();
      };
      socket.onerror = () => {
        if (!disposed) setStatus("文件监听断开，可手动刷新。");
      };
      socket.onclose = () => {
        if (disposed) return;
        setStatus("文件监听断开，正在重连；可手动刷新。");
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10_000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [id, signature]);
  return status;
}
