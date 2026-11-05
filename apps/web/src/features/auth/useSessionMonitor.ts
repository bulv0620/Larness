import { WorkspaceSessionNotificationSchema } from "@larness/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useSessionMonitor(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const workspace = { queryKey: ["workspace"], exact: true };

    const refreshWorkspace = async (): Promise<void> => {
      // An in-flight first fetch may have started before the system subscription.
      if (queryClient.getQueryData(workspace.queryKey) === undefined) {
        await queryClient.cancelQueries(workspace);
      }
      if (!disposed) await queryClient.invalidateQueries(workspace);
    };

    const connect = (): void => {
      const current = new WebSocket(`${protocol}://${window.location.host}/ws`);
      socket = current;
      let opened = false;

      current.addEventListener("open", () => {
        opened = true;
        current.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "system", resourceId: "system" }],
          }),
        );
      });
      current.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        try {
          if (WorkspaceSessionNotificationSchema.safeParse(JSON.parse(event.data)).success) {
            void refreshWorkspace();
          }
        } catch {
          // Ignore malformed frames.
        }
      });
      current.addEventListener("close", () => {
        if (disposed) return;
        if (opened) {
          void queryClient.invalidateQueries({ queryKey: ["session"] });
          void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        }
        reconnectTimer = window.setTimeout(connect, 1_000);
      });
      current.addEventListener("error", () => current.close());
    };

    connect();

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [queryClient]);
}
