import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export function useSessionMonitor(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let disposed = false;
    let opened = false;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

    socket.addEventListener("open", () => {
      opened = true;
    });
    socket.addEventListener("close", () => {
      if (opened && !disposed) {
        void queryClient.invalidateQueries({ queryKey: ["session"] });
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      }
    });
    socket.addEventListener("error", () => socket.close());

    return () => {
      disposed = true;
      socket.close();
    };
  }, [queryClient]);
}
