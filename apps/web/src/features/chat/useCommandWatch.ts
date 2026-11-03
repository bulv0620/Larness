import { CommandOutputEventSchema, CommandStatusEventSchema } from "@larness/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function useCommandWatch(commandId: string, active: boolean) {
  const client = useQueryClient();
  const [status, setStatus] = useState("正在连接输出…");
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let invalidate: ReturnType<typeof setTimeout> | undefined;
    let backoff = 1000;
    let refreshState = false;
    const refresh = (outputOnly = false) => {
      refreshState ||= !outputOnly;
      if (disposed || invalidate) return;
      invalidate = setTimeout(() => {
        invalidate = undefined;
        if (!disposed) {
          void client.invalidateQueries({ queryKey: ["command", commandId, "output"] });
          if (refreshState)
            void client.invalidateQueries({ queryKey: ["command", commandId, "state"] });
        }
        refreshState = false;
      }, 250);
    };
    const connect = () => {
      if (disposed) return;
      const url = new URL("/ws", window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(url);
      socket.onopen = () => {
        socket?.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "command", resourceId: commandId, after: 0 }],
          }),
        );
        backoff = 1000;
        setStatus("实时输出已连接");
        refresh(); // Snapshots and output cursors close gaps after each reconnect.
      };
      socket.onmessage = (message) => {
        let raw: unknown;
        try {
          raw = JSON.parse(String(message.data));
        } catch {
          return;
        }
        const output = CommandOutputEventSchema.safeParse(raw);
        const event = CommandStatusEventSchema.safeParse(raw);
        if (output.success && output.data.resourceId === commandId) refresh(true);
        if (event.success && event.data.resourceId === commandId) refresh();
      };
      socket.onerror = () => setStatus("输出连接中断，正在刷新状态…");
      socket.onclose = () => {
        if (disposed) return;
        setStatus("输出连接中断，正在重连…");
        refresh();
        reconnect = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 10000);
      };
    };
    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnect);
      clearTimeout(invalidate);
      socket?.close();
    };
  }, [active, client, commandId]);
  return status;
}
