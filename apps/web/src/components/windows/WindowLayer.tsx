import { useEffect, useState } from "react";
import { WindowFrame } from "@/components/windows/WindowFrame";
import { FileLifecycle } from "@/features/files/FileLifecycle";
import { TerminalScreenProvider } from "@/features/terminals/TerminalScreens";
import { USE_MOCKS } from "@/lib/env";
import { useSnapshot } from "@/lib/queries";
import type { ManagedWindow } from "@/lib/windowTypes";
import { activeWindowScope } from "@/lib/workspaceScope";
import { useNavigationStore } from "@/stores/navigationStore";
import { useWindowStore, windowScopeKey } from "@/stores/windowStore";
import { WindowCloseDialog } from "./WindowCloseDialog";

function WindowSlot({ window }: { window: ManagedWindow }) {
  const [opened, setOpened] = useState(!window.minimized);
  if (!opened) {
    if (window.minimized) return null;
    setOpened(true);
  }
  return <WindowFrame window={window} />;
}

export function WindowLayer() {
  const { projectId, sessionId } = useNavigationStore();
  const { data } = useSnapshot();
  const scope = activeWindowScope(projectId, sessionId, data.sessions);
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

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      // A modal handles its own backdrop and may be waiting for a pending operation.
      if (
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
        )
      )
        return;
      // Menus and confirmation dialogs can be portalled outside their window frame.
      if (
        event.target.closest(
          '[data-window-frame], [data-window-dock], [data-project-resources], [role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      useWindowStore.getState().hideScope(scope);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [scope]);

  return (
    <TerminalScreenProvider windows={windows}>
      <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
        <WindowCloseDialog />
        {!USE_MOCKS ? <FileLifecycle /> : null}
        {windows
          .filter((win) => windowScopeKey(win) === scope)
          .map((win) => (
            <WindowSlot key={win.id} window={win} />
          ))}
      </div>
    </TerminalScreenProvider>
  );
}
