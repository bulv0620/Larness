import { useEffect } from "react";
import { WindowFrame } from "@/components/windows/WindowFrame";
import { FileLifecycle } from "@/features/files/FileLifecycle";
import { USE_MOCKS } from "@/lib/env";
import { useNavigationStore } from "@/stores/navigationStore";
import { resourceScopeKey, useWindowStore, windowScopeKey } from "@/stores/windowStore";

export function WindowLayer() {
  const { projectId, sessionId } = useNavigationStore();
  const scope = resourceScopeKey(projectId, projectId ? null : sessionId);
  const windows = useWindowStore((state) => state.windows);
  const setBounds = useWindowStore((state) => state.setBounds);

  useEffect(() => {
    const onResize = () => {
      for (const win of useWindowStore.getState().windows) {
        if (!win.maximized) {
          setBounds(win.id, { x: win.x, y: win.y, width: win.width, height: win.height });
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setBounds]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const win of useWindowStore.getState().windows) {
        if (!win.maximized) {
          setBounds(win.id, { x: win.x, y: win.y, width: win.width, height: win.height });
        }
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [setBounds]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {!USE_MOCKS ? <FileLifecycle /> : null}
      {windows
        .filter(
          (win) =>
            !win.minimized &&
            (windowScopeKey(win) === scope || (!projectId && windowScopeKey(win) === "global")),
        )
        .map((win) => (
          <WindowFrame key={win.id} window={win} />
        ))}
    </div>
  );
}
