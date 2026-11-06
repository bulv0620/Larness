import { cn, IconButton } from "@larness/ui";
import { Maximize2, Minimize2, Minus, Pin, PinOff, X } from "lucide-react";
import { Rnd } from "react-rnd";
import { useWindowTitle } from "@/components/windows/useWindowTitle";
import { WindowContent } from "@/components/windows/WindowContent";
import { WindowTabs } from "@/components/windows/WindowTabs";
import { useSnapshot } from "@/lib/queries";
import { activeWindowTab, filterTabs } from "@/lib/windowFilters";
import type { ManagedWindow } from "@/lib/windowTypes";
import { useWindowStore } from "@/stores/windowStore";

export function WindowFrame({ window: win }: { window: ManagedWindow }) {
  const focus = useWindowStore((state) => state.focus);
  const close = useWindowStore((state) => state.close);
  const hide = useWindowStore((state) => state.hide);
  const toggleMaximize = useWindowStore((state) => state.toggleMaximize);
  const togglePin = useWindowStore((state) => state.togglePin);
  const setBounds = useWindowStore((state) => state.setBounds);
  const { data } = useSnapshot();
  const visibleTabs = filterTabs(win.tabs, win.filter);
  const activeTab = activeWindowTab(visibleTabs, win.activeTabId);
  const title = useWindowTitle(activeTab, data);

  return (
    <Rnd
      bounds="parent"
      dragHandleClassName="window-drag-handle"
      cancel=".window-no-drag"
      disableDragging={win.maximized}
      enableResizing={!win.maximized}
      minWidth={420}
      minHeight={280}
      size={
        win.maximized ? { width: "100%", height: "100%" } : { width: win.width, height: win.height }
      }
      position={win.maximized ? { x: 0, y: 0 } : { x: win.x, y: win.y }}
      onMouseDown={() => focus(win.id)}
      onDragStop={(_event, position) =>
        setBounds(win.id, { x: position.x, y: position.y, width: win.width, height: win.height })
      }
      onResizeStop={(_event, _direction, ref, _delta, position) =>
        setBounds(win.id, {
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
      }
      style={{ zIndex: win.z, display: win.minimized ? "none" : "flex", flexDirection: "column" }}
      inert={win.minimized}
      data-window-frame={win.id}
      role="dialog"
      aria-label={title}
      className={cn(
        "pointer-events-auto flex flex-col overflow-hidden border border-line bg-surface window-shadow",
        win.maximized ? "rounded-none" : "rounded-xl",
      )}
    >
      <div className="window-drag-handle flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface-2/55 px-3">
        <div className="window-no-drag group/traffic flex items-center gap-1.5">
          <button
            type="button"
            aria-label="关闭窗口"
            title="关闭窗口"
            onClick={() => close(win.id)}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f57] text-[8px] text-[#6b0d08] opacity-95 transition-opacity hover:brightness-95"
          >
            <X size={7} strokeWidth={2.8} className="opacity-0 group-hover/traffic:opacity-100" />
          </button>
          <button
            type="button"
            aria-label="隐藏窗口"
            title="隐藏窗口"
            onClick={() => hide(win.id)}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-[#febc2e] text-[8px] text-[#6b4b00] opacity-95 transition-opacity hover:brightness-95"
          >
            <Minus size={7} strokeWidth={3} className="opacity-0 group-hover/traffic:opacity-100" />
          </button>
          <button
            type="button"
            aria-label={win.maximized ? "还原窗口" : "最大化窗口"}
            title={win.maximized ? "还原窗口" : "最大化窗口"}
            onClick={() => toggleMaximize(win.id)}
            className="flex h-3 w-3 items-center justify-center rounded-full bg-[#28c840] text-[8px] text-[#0b4d12] opacity-95 transition-opacity hover:brightness-95"
          >
            {win.maximized ? (
              <Minimize2
                size={7}
                strokeWidth={2.8}
                className="opacity-0 group-hover/traffic:opacity-100"
              />
            ) : (
              <Maximize2
                size={7}
                strokeWidth={2.8}
                className="opacity-0 group-hover/traffic:opacity-100"
              />
            )}
          </button>
        </div>

        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-center">
          <div className="max-w-[260px] truncate text-[11.5px] font-medium text-ink">{title}</div>
          <div className="text-[9px] text-ink-3">{kindLabel(activeTab?.kind)}</div>
        </div>

        <div className="window-no-drag ml-auto flex items-center">
          <IconButton
            label={win.pinned ? "取消置顶" : "置顶窗口"}
            active={win.pinned}
            className="h-6 w-6"
            onClick={() => togglePin(win.id)}
          >
            {win.pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </IconButton>
        </div>
      </div>

      {activeTab?.kind !== "services" ? <WindowTabs window={win} /> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab ? (
          <WindowContent tab={activeTab} visible={!win.minimized} />
        ) : (
          <div className="flex h-full items-center justify-center text-[11px] text-ink-3">
            暂无打开的 Tab
          </div>
        )}
      </div>
    </Rnd>
  );
}

function kindLabel(kind: string | undefined): string {
  switch (kind) {
    case "files":
      return "文件";
    case "terminal":
      return "终端";
    case "services":
      return "服务";
    case "browser":
      return "预览";
    case "git-diff":
      return "Diff";
    default:
      return "";
  }
}
