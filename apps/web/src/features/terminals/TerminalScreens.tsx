import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import type { ManagedWindow } from "@/lib/windowTypes";

interface TerminalScreen {
  terminal: Terminal;
  fit: FitAddon;
  cursor: number;
  log: string;
  gap: boolean;
  ready: boolean;
  pendingWrite: Promise<void>;
}

const TerminalScreensContext = createContext<Map<string, TerminalScreen> | null>(null);

export function TerminalScreenProvider({
  children,
  windows,
}: {
  children: ReactNode;
  windows: ManagedWindow[];
}) {
  const [screens] = useState(() => new Map<string, TerminalScreen>());
  useEffect(() => {
    if (!screens.size) return;
    const tabs = new Set(windows.flatMap((win) => win.tabs.map((tab) => tab.id)));
    for (const [id, screen] of screens) {
      if (tabs.has(id)) continue;
      screen.terminal.dispose();
      screens.delete(id);
    }
  }, [screens, windows]);
  useEffect(
    () => () => {
      for (const screen of screens.values()) screen.terminal.dispose();
      screens.clear();
    },
    [screens],
  );

  return (
    <TerminalScreensContext.Provider value={screens}>{children}</TerminalScreensContext.Provider>
  );
}

export function useTerminalScreens() {
  const screens = useContext(TerminalScreensContext);
  if (!screens) throw new Error("Terminal screen provider is missing");
  return screens;
}

export function createTerminalScreen(): TerminalScreen {
  const terminal = new Terminal({
    fontSize: 12,
    fontFamily: "ui-monospace, Menlo, monospace",
    cursorBlink: true,
    scrollback: 2000,
    disableStdin: true,
    theme: { background: "#0f1115", foreground: "#d7dae0" },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  return {
    terminal,
    fit,
    cursor: 0,
    log: "",
    gap: false,
    ready: false,
    pendingWrite: Promise.resolve(),
  };
}
