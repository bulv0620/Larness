import { cn } from "@larness/ui";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { compactModelWindow } from "@/features/models/ModelCapabilities";
import type { ApiCatalogGroup, ApiCatalogModel } from "@/lib/workspaceApi";

interface ModelControlProps {
  groups: ApiCatalogGroup[];
  model: ApiCatalogModel | undefined;
  credentialProfileId: string | null;
  thinking: string;
  catalogError: unknown;
  disabled: boolean;
  onSelectModel: (modelId: string, credentialProfileId: string) => void;
  onSelectThinking: (thinking: string) => void;
}

type View = "root" | "models" | "thinking";

const menuRow =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 disabled:opacity-50";

export function ModelControl({
  groups,
  model,
  credentialProfileId,
  thinking,
  catalogError,
  disabled,
  onSelectModel,
  onSelectThinking,
}: ModelControlProps) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("root");
  const mode = model?.thinking.mode;
  const levels = !model?.thinking.supported
    ? []
    : mode === "toggle"
      ? [
          { id: "off", label: "关闭" },
          { id: "on", label: "开启" },
        ]
      : [
          ...(mode === "mandatory-levels" || mode === "variants"
            ? []
            : [{ id: "off", label: "关闭" }]),
          ...model.thinking.levels,
        ];
  const thinkingLabel = levels.find((level) => level.id === thinking)?.label;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const showView = (next: View) => {
    panelRef.current?.focus();
    setView(next);
  };

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`模型与思考：${model?.label ?? "选择模型"}${thinkingLabel ? ` · ${thinkingLabel}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? panelId : undefined}
        disabled={disabled}
        onClick={() => {
          setView("root");
          setOpen(!open);
        }}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="max-w-[96px] truncate sm:max-w-[144px]">{model?.label ?? "选择模型"}</span>
        {thinkingLabel ? (
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold",
              thinking === "off" || thinking === "effort:none" ? "text-ink-3" : "text-accent",
            )}
          >
            <span aria-hidden="true" className="mr-1 text-ink-3">
              ·
            </span>
            {thinkingLabel}
          </span>
        ) : null}
        <ChevronDown size={11} aria-hidden="true" className="shrink-0 text-ink-3" />
      </button>

      {open && !disabled ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="模型与思考"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
          className="absolute bottom-[calc(100%+8px)] left-0 z-40 flex max-h-[min(360px,55dvh)] w-[min(240px,calc(100vw-68px))] flex-col overflow-hidden rounded-xl border border-line bg-surface/95 p-1.5 text-ink shadow-[var(--shadow-pop)] outline-none backdrop-blur-xl"
        >
          {view === "root" ? (
            <>
              <button
                type="button"
                aria-label={`模型：${model?.label ?? "选择模型"}`}
                onClick={() => showView("models")}
                className={menuRow}
              >
                <span className="w-14 shrink-0 text-[10px] text-ink-3">模型</span>
                <span className="min-w-0 flex-1 truncate text-ink">
                  {model?.label ?? "选择模型"}
                </span>
                <ChevronRight size={11} aria-hidden="true" className="text-ink-3" />
              </button>
              <button
                type="button"
                aria-label={`思考强度：${thinkingLabel ?? "不支持"}`}
                disabled={levels.length === 0}
                onClick={() => showView("thinking")}
                className={menuRow}
              >
                <span className="w-14 shrink-0 text-[10px] text-ink-3">思考强度</span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    thinkingLabel &&
                      thinking !== "off" &&
                      thinking !== "effort:none" &&
                      "text-accent",
                  )}
                >
                  {thinkingLabel ?? "不支持"}
                </span>
                {levels.length > 0 ? (
                  <ChevronRight size={11} aria-hidden="true" className="text-ink-3" />
                ) : null}
              </button>
            </>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-1 px-1 pb-1 pt-0.5">
                <button
                  type="button"
                  aria-label="返回"
                  onClick={() => showView("root")}
                  className="grid size-5 place-items-center rounded-md text-ink-3 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <ChevronLeft size={12} aria-hidden="true" />
                </button>
                <span className="text-[10.5px] font-semibold text-ink-3">
                  {view === "models" ? "模型" : "思考强度"}
                </span>
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain">
                {view === "models" ? (
                  <>
                    {groups.length === 0 ? (
                      <p className="px-2 py-2 text-[11px] text-ink-3">
                        {catalogError
                          ? "目录不可用，请在模型设置中刷新。"
                          : "请先在模型设置中添加 Key。"}
                      </p>
                    ) : null}
                    {groups.map((group) => {
                      const headingId = `${panelId}-${group.credentialProfileId}`;
                      return (
                        <div key={group.credentialProfileId}>
                          <div
                            id={headingId}
                            className="truncate px-2.5 pb-0.5 pt-1.5 text-[10px] text-ink-3"
                          >
                            {group.credentialLabel}
                          </div>
                          <ul aria-labelledby={headingId}>
                            {group.models.length === 0 ? (
                              <li className="px-2.5 py-1.5 text-[10.5px] text-ink-3">
                                {group.lastRefreshError
                                  ? "目录读取失败，请在设置中刷新。"
                                  : "此 Key 暂无可选模型"}
                              </li>
                            ) : null}
                            {group.models.map((item) => {
                              const selected =
                                item.id === model?.id &&
                                group.credentialProfileId === credentialProfileId;
                              return (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    aria-label={item.label}
                                    aria-pressed={selected}
                                    onClick={() => {
                                      close();
                                      onSelectModel(item.id, group.credentialProfileId);
                                    }}
                                    className={cn(menuRow, selected && "bg-surface-2 text-ink")}
                                  >
                                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                                    <span className="text-[9.5px] text-ink-3">
                                      {compactModelWindow(item)}
                                    </span>
                                    {selected ? (
                                      <Check
                                        size={13}
                                        aria-hidden="true"
                                        className="shrink-0 text-accent"
                                      />
                                    ) : null}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  levels.map((level) => (
                    <button
                      key={level.id}
                      type="button"
                      aria-pressed={level.id === thinking}
                      onClick={() => {
                        close();
                        if (level.id !== thinking) onSelectThinking(level.id);
                      }}
                      className={cn(menuRow, level.id === thinking && "bg-surface-2 text-ink")}
                    >
                      <span className="flex-1">{level.label}</span>
                      {level.id === thinking ? (
                        <Check size={13} aria-hidden="true" className="shrink-0 text-accent" />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
