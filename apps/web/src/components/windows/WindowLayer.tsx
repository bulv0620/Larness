import { useEffect } from "react";
import { WindowFrame } from "@/components/windows/WindowFrame";
import { useWindowStore } from "@/stores/windowStore";

export function WindowLayer() {
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
      {windows
        .filter((win) => !win.minimized)
        .map((win) => (
          <WindowFrame key={win.id} window={win} />
        ))}
    </div>
  );
}
