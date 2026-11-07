import { cn } from "@larness/ui";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ApiCatalogModel } from "@/lib/workspaceApi";

interface ModelControlProps {
  models: ApiCatalogModel[];
  model: ApiCatalogModel | undefined;
  thinking: string;
  catalogError: unknown;
  credentialLabel?: string;
  onSelectModel: (modelId: string) => void;
  onSelectThinking: (thinking: string) => void;
}

const THINKING_LEVELS = [
  { id: "off", label: "关闭" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

function levelLabel(thinking: string): string {
  return THINKING_LEVELS.find((level) => level.id === thinking)?.label ?? "中";
}

export function ModelControl({
  models,
  model,
  thinking,
  catalogError,
  credentialLabel,
  onSelectModel,
  onSelectThinking,
}: ModelControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "models" | "thinking">("root");

  const thinkingEnabled = model?.thinking.supported === true;
  const currentThinking = thinkingEnabled ? levelLabel(thinking) : "不支持";
  const keyLabel = credentialLabel ?? "未配置凭据";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleOpen = () => {
    setView("root");
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

  const selectThinking = (level: string) => {
    onSelectThinking(level);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={`模型与思考：${model?.label ?? "未配置凭据"} · ${currentThinking}`}
        aria-expanded={open}
        onClick={toggleOpen}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
      >
        <span className="max-w-[96px] truncate sm:max-w-[128px]">{model?.label ?? "选择模型"}</span>
        {model ? (
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold",
              thinking === "off" || !thinkingEnabled ? "text-ink-3" : "text-accent",
            )}
          >
            {currentThinking}
          </span>
        ) : null}
        <ChevronDown size={11} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="模型与思考"
          className="absolute bottom-[calc(100%+8px)] left-0 z-40 w-[240px] rounded-xl border border-line bg-surface/95 p-1.5 text-ink shadow-[var(--shadow-pop)] backdrop-blur-xl"
        >
          {view === "root" ? (
            <>
              <button
                type="button"
                aria-label={`模型：${model?.label ?? "选择模型"}`}
                onClick={() => setView("models")}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-black/[.05] dark:hover:bg-white/[.07]"
              >
                <span className="w-12 shrink-0 text-[10px] text-ink-3">模型</span>
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">
                  {model?.label ?? "选择模型"}
                </span>
                <ChevronRight size={11} className="shrink-0 text-ink-3" />
              </button>
              <button
                type="button"
                aria-label={`思考等级：${currentThinking}`}
                disabled={!thinkingEnabled}
                onClick={() => setView("thinking")}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-black/[.05] disabled:opacity-50 dark:hover:bg-white/[.07]"
              >
                <span className="w-12 shrink-0 text-[10px] text-ink-3">思考等级</span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-[11.5px]",
                    thinkingEnabled && thinking !== "off" ? "text-accent" : "text-ink",
                  )}
                >
                  {currentThinking}
                </span>
                {thinkingEnabled ? (
                  <ChevronRight size={11} className="shrink-0 text-ink-3" />
                ) : null}
              </button>
            </>
          ) : null}

          {view === "models" ? (
            <>
              <div className="flex items-center gap-1 px-1 pb-1 pt-0.5">
                <button
                  type="button"
                  aria-label="返回"
                  onClick={() => setView("root")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10.5px] font-semibold text-ink-3">模型</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <div className="truncate px-2.5 pb-1 text-[10px] text-ink-3">{keyLabel}</div>
                {models.length === 0 ? (
                  <p className="mx-1 rounded-lg border border-dashed border-line px-2 py-1.5 text-[10.5px] leading-relaxed text-ink-3">
                    {catalogError
                      ? "读取模型目录失败。请在设置中检查凭据后刷新。"
                      : "该 Key 还没有可用模型。请先在设置中刷新目录。"}
                  </p>
                ) : (
                  models.map((item) => {
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
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {selected ? <Check size={13} className="shrink-0 text-accent" /> : null}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          ) : null}

          {view === "thinking" ? (
            <>
              <div className="flex items-center gap-1 px-1 pb-1 pt-0.5">
                <button
                  type="button"
                  aria-label="返回"
                  onClick={() => setView("root")}
                  className="flex h-5 w-5 items-center justify-center rounded-md text-ink-3 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]"
                >
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10.5px] font-semibold text-ink-3">思考等级</span>
              </div>
              {THINKING_LEVELS.map((level) => {
                const selected = level.id === thinking;
                return (
                  <button
                    key={level.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectThinking(level.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] transition-colors",
                      selected
                        ? "bg-black/[.04] text-ink dark:bg-white/[.06]"
                        : "text-ink-2 hover:bg-black/[.05] hover:text-ink dark:hover:bg-white/[.07]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{level.label}</span>
                    {selected ? <Check size={13} className="shrink-0 text-accent" /> : null}
                  </button>
                );
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
