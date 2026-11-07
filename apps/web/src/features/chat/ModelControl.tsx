import { cn } from "@larness/ui";
import { Check, ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApiCatalogModel } from "@/lib/workspaceApi";

interface ModelControlProps {
  models: ApiCatalogModel[];
  model: ApiCatalogModel | undefined;
  thinking: string;
  catalogError: unknown;
  onSelectModel: (modelId: string) => void;
  onSelectThinking: (thinking: string) => void;
  onRefresh: () => Promise<void>;
}

const THINKING_LADDER = [
  { id: "off", label: "关闭" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

function thinkingOptions(model: ApiCatalogModel | undefined): { id: string; label: string }[] {
  if (model === undefined || !model.thinking.supported) {
    return [];
  }

  return THINKING_LADDER;
}

function windowLabel(model: ApiCatalogModel): string {
  return model.contextWindow === null
    ? "上下文未知"
    : `${model.contextWindow.toLocaleString("en-US")} 上下文`;
}

export function ModelControl({
  models,
  model,
  thinking,
  catalogError,
  onSelectModel,
  onSelectThinking,
  onRefresh,
}: ModelControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"effort" | "models">("effort");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const options = thinkingOptions(model);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === thinking),
  );
  const selectedLabel = options[selectedIndex]?.label ?? "关闭";
  const isOff = options.length === 0 || options[selectedIndex]?.id === "off";
  const percent = options.length <= 1 ? 0 : (selectedIndex / (options.length - 1)) * 100;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setRefreshError(null);
      return;
    }

    if (view === "effort") {
      sliderRef.current?.focus();
    }
  }, [open, view]);

  const pickIndex = (index: number) => {
    const option = options[Math.min(options.length - 1, Math.max(0, index))];
    if (option !== undefined) onSelectThinking(option.id);
  };

  const pickRatio = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const padding = 7;
    const usable = Math.max(1, rect.width - padding * 2);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - padding) / usable));
    pickIndex(Math.round(ratio * (options.length - 1)));
  };

  const handleSliderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (options.length === 0) return;

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      pickIndex(selectedIndex + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      pickIndex(selectedIndex - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      pickIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      pickIndex(options.length - 1);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await onRefresh();
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "刷新模型目录失败");
    } finally {
      setRefreshing(false);
    }
  };

  const toggleOpen = () => {
    setView("effort");
    setOpen((current) => !current);
  };

  const selectModel = (modelId: string) => {
    onSelectModel(modelId);
    const next = models.find((item) => item.id === modelId);
    if (next !== undefined && !next.thinking.supported) {
      onSelectThinking("off");
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`模型与思考：${model?.label ?? "未配置凭据"} · ${selectedLabel}`}
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
      >
        <span className="max-w-[96px] truncate sm:max-w-[128px]">{model?.label ?? "选择模型"}</span>
        {model ? (
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold",
              isOff ? "text-ink-3" : "text-accent",
            )}
          >
            {selectedLabel}
          </span>
        ) : null}
        <ChevronDown size={11} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="模型与思考"
          className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[264px] rounded-xl border border-line bg-surface/95 p-1.5 text-ink shadow-[var(--shadow-pop)] backdrop-blur-xl"
        >
          {view === "effort" ? (
            <>
              <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5">
                <span className="text-[10.5px] font-semibold text-ink-3">思考强度</span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "text-[11px] font-semibold",
                      isOff ? "text-ink-3" : "text-accent",
                    )}
                  >
                    {selectedLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="刷新模型目录"
                    disabled={refreshing}
                    onClick={() => void refresh()}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.05] hover:text-ink disabled:opacity-50 dark:hover:bg-white/[.07]"
                  >
                    <RotateCw size={11} className={refreshing ? "animate-spin" : undefined} />
                  </button>
                </span>
              </div>

              <button
                type="button"
                aria-label={model ? `切换模型：${model.label}` : "选择模型"}
                onClick={() => (models.length === 0 ? undefined : setView("models"))}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 transition-colors hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
              >
                <span className="min-w-0 flex-1 truncate">{model?.label ?? "选择模型"}</span>
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-ink-3">
                  切换 <ChevronRight size={10} />
                </span>
              </button>

              {models.length > 0 && options.length === 0 ? (
                <p className="mx-1 mt-1 rounded-lg border border-dashed border-line px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-3">
                  该模型不支持思考档位，将使用非思考模式。
                </p>
              ) : null}

              {models.length === 0 ? (
                <p className="mx-1 mt-1 rounded-lg border border-dashed border-line px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-3">
                  {catalogError
                    ? "读取模型目录失败。请在设置中检查凭据后刷新。"
                    : "未配置凭据。先在设置中添加 DeepSeek Key 并刷新目录。"}
                </p>
              ) : (
                <>
                  <div
                    ref={sliderRef}
                    role="slider"
                    tabIndex={0}
                    aria-label="思考强度"
                    aria-valuemin={0}
                    aria-valuemax={Math.max(0, options.length - 1)}
                    aria-valuenow={selectedIndex}
                    aria-valuetext={selectedLabel}
                    onKeyDown={handleSliderKeyDown}
                    onPointerDown={(event) => {
                      draggingRef.current = true;
                      event.currentTarget.setPointerCapture(event.pointerId);
                      pickRatio(event.clientX, event.currentTarget);
                    }}
                    onPointerMove={(event) => {
                      if (draggingRef.current) pickRatio(event.clientX, event.currentTarget);
                    }}
                    onPointerUp={(event) => {
                      draggingRef.current = false;
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    onPointerCancel={() => {
                      draggingRef.current = false;
                    }}
                    className="relative mx-2.5 mt-1 h-8 cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    <div className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 overflow-hidden rounded-full bg-black/[.07] dark:bg-white/[.12]">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    {options.map((option, index) => (
                      <span
                        key={option.id}
                        aria-hidden="true"
                        className={cn(
                          "absolute top-1/2 h-[2px] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full",
                          index <= selectedIndex ? "bg-white/70" : "bg-black/20 dark:bg-white/30",
                        )}
                        style={{
                          left: `clamp(7px, ${
                            options.length <= 1 ? 0 : (index / (options.length - 1)) * 100
                          }%, calc(100% - 7px))`,
                        }}
                      />
                    ))}
                    <div
                      className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,.28)]"
                      style={{ left: `clamp(7px, ${percent}%, calc(100% - 7px))` }}
                    />
                  </div>

                  <div className="mx-2.5 mb-0.5 flex justify-between text-[9px] text-ink-3">
                    <span>{options[0]?.label}</span>
                    <span>{options[options.length - 1]?.label}</span>
                  </div>
                </>
              )}

              {refreshError ? (
                <p className="mx-1 mt-1 rounded-md bg-danger/10 px-2 py-1 text-[10px] text-danger">
                  {refreshError}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-semibold text-ink-3">
                选择模型
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <div className="px-2.5 pb-1 text-[10px] text-ink-3">推荐模型集</div>
                {models.map((item) => {
                  const selected = item.id === model?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => selectModel(item.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] transition-colors",
                        selected
                          ? "bg-black/[.04] text-ink dark:bg-white/[.06]"
                          : "text-ink-2 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{item.label}</span>
                        <span className="block truncate text-[10px] text-ink-3">
                          {windowLabel(item)}
                          {item.thinking.supported
                            ? ` · 思考 ${THINKING_LADDER.slice(1)
                                .map((level) => level.label)
                                .join("/")}`
                            : ""}
                        </span>
                      </span>
                      {selected ? <Check size={13} className="shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
