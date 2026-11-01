import type { TerminalInfo } from "@larness/shared";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

const theme = {
  background: "#0f1115",
  foreground: "#d7dae0",
  cursor: "#7db8ff",
  selectionBackground: "rgba(125,184,255,.28)",
  black: "#1b1d23",
  red: "#ff6b6b",
  green: "#5dd39e",
  yellow: "#f7c948",
  blue: "#7db8ff",
  magenta: "#c792ea",
  cyan: "#63d8d8",
  white: "#d7dae0",
};

export function TerminalView({ terminal }: { terminal: TerminalInfo | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const term = new XTerm({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.5,
      cursorBlink: true,
      convertEol: true,
      scrollback: 2000,
      theme,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    termRef.current = term;

    const resize = () => {
      try {
        fit.fit();
      } catch {
        // Ignore fit errors while the window is hidden.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    window.setTimeout(resize, 30);

    term.writeln("\x1b[38;5;245mLast login: Fri Oct 31 20:41:12 on ttys004\x1b[0m");
    term.writeln(`\x1b[38;5;245m${terminal?.cwd ?? "~"}\x1b[0m`);
    term.writeln("");
    term.write(`\x1b[38;5;114m➜\x1b[0m \x1b[38;5;81m${terminal?.title ?? "shell"}\x1b[0m\r\n`);
    term.writeln("\x1b[38;5;245m> vite --host 127.0.0.1\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[38;5;114mVITE v7.3.7\x1b[0m  ready in \x1b[38;5;221m412\x1b[0m ms");
    term.writeln("");
    term.writeln(
      `  \x1b[38;5;114m➜\x1b[0m  Local:   \x1b[38;5;81mhttp://localhost:${terminal?.port ?? 5173}/\x1b[0m`,
    );
    term.writeln("  \x1b[38;5;114m➜\x1b[0m  press \x1b[38;5;221mh + enter\x1b[0m to show help");
    term.writeln("");

    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      if (tick % 3 === 0) {
        term.writeln(
          "\x1b[38;5;245m20:45:16\x1b[0m \x1b[38;5;114m[hmr]\x1b[0m update /src/app/AppShell.tsx",
        );
      }
    }, 4200);
    term.focus();

    return () => {
      window.clearInterval(timer);
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [terminal?.cwd, terminal?.port, terminal?.title]);

  return (
    <div ref={containerRef} className="h-full w-full" role="application" aria-label="终端输出" />
  );
}
