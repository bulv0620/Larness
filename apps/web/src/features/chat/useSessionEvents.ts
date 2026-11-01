import { useEffect } from "react";
import { useTimelineStore } from "@/stores/timelineStore";

export function useSessionEvents(sessionId: string): void {
  const load = useTimelineStore((state) => state.load);
  const disconnect = useTimelineStore((state) => state.disconnect);

  useEffect(() => {
    void load(sessionId);
    return () => disconnect();
  }, [disconnect, load, sessionId]);
}
