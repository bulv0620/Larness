import { cn } from "@larness/ui";
import { Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { billingLabel, modelRows, providerLabel } from "@/features/models/catalogView";
import type { ApiCatalogGroup, ApiCatalogModel } from "@/lib/workspaceApi";

interface ModelControlProps {
  groups: ApiCatalogGroup[];
  model: ApiCatalogModel | undefined;
  credentialProfileId: string | null;
  thinking: string;
  catalogError: unknown;
  disabled: boolean;
  credentialLabel?: string;
  onSelectModel: (modelId: string, credentialProfileId: string) => void;
  onSelectThinking: (thinking: string) => void;
}

const THINKING_LEVELS = [
  { id: "off", label: "关闭" },
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
];

function levelLabel(thinking: string): string {
  if (thinking === "on") return "开启";
  return THINKING_LEVELS.find((level) => level.id === thinking)?.label ?? "关闭";
}

export function ModelControl({
  groups,
  model,
  credentialProfileId,
  thinking,
  credentialLabel,
  catalogError,
  disabled,
  onSelectModel,
  onSelectThinking,
}: ModelControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"root" | "models" | "thinking" | "connections">("root");

  const [search, setSearch] = useState("");
  const [routeKey, setRouteKey] = useState("");
  const rows = modelRows(groups);
  const routes = rows.find(([key]) => key === routeKey)?.[1] ?? [];
  const thinkingEnabled = model?.thinking.supported === true;
  const currentThinking = thinkingEnabled ? levelLabel(thinking) : "不支持";
  const mode = model?.thinking.mode;
  const levels =
    mode === "toggle"
      ? [
          { id: "off", label: "关闭" },
          { id: "on", label: "开启" },
        ]
      : [
          ...(mode === "mandatory-levels" ? [] : [{ id: "off", label: "关闭" }]),
          ...(model?.thinking.levels ?? []),
        ];

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

  const selectModel = (modelId: string, nextCredentialProfileId: string) => {
    onSelectModel(modelId, nextCredentialProfileId);
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
        disabled={disabled}
        onClick={toggleOpen}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="max-w-[96px] truncate sm:max-w-[128px]">
            {model?.label ?? "选择模型"}
          </span>
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
        </span>
        {credentialLabel ? (
          <span className="hidden max-w-24 truncate text-[10px] text-ink-3 sm:inline">
            {credentialLabel}
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
              <input
                aria-label="搜索会话模型"
                placeholder="搜索模型或平台"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="my-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs"
              />
              <div className="max-h-[300px] overflow-y-auto">
                {rows.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-ink-3">
                    {catalogError
                      ? "目录不可用，请在模型设置中刷新。"
                      : "没有可选模型，请在模型设置中添加连接。"}
                  </p>
                ) : null}
                {rows
                  .filter(([, candidates]) =>
                    candidates.some(({ group, model: item }) =>
                      `${item.label} ${item.id} ${providerLabel(group.provider)} ${group.credentialLabel}`
                        .toLowerCase()
                        .includes(search.trim().toLowerCase()),
                    ),
                  )
                  .map(([key, candidates]) => {
                    const active = candidates.find(
                      ({ group, model: item }) =>
                        item.id === model?.id && group.credentialProfileId === credentialProfileId,
                    );
                    const first = active ?? candidates[0];
                    if (!first) return null;
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active !== undefined}
                        onClick={() => {
                          if (candidates.length === 1)
                            selectModel(first.model.id, first.group.credentialProfileId);
                          else {
                            setRouteKey(key);
                            setView("connections");
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11.5px] hover:bg-surface-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{first.model.label}</span>
                          <span className="block truncate text-[10px] text-ink-3">
                            {providerLabel(first.group.provider)} · {first.group.credentialLabel}
                          </span>
                        </span>
                        {candidates.length > 1 ? (
                          <span className="text-[10px] text-ink-3">{candidates.length} 个连接</span>
                        ) : null}
                        {active ? <Check size={13} className="shrink-0 text-accent" /> : null}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : null}

          {view === "connections" ? (
            <>
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 text-xs"
                onClick={() => setView("models")}
              >
                <ChevronLeft size={12} />
                返回模型
              </button>
              {routes.map(({ group, model: item }) => (
                <button
                  key={group.credentialProfileId}
                  type="button"
                  aria-pressed={
                    credentialProfileId === group.credentialProfileId && item.id === model?.id
                  }
                  onClick={() => selectModel(item.id, group.credentialProfileId)}
                  className="block w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-surface-2"
                >
                  {group.credentialLabel}
                  <span className="block text-[10px] text-ink-3">
                    {billingLabel(group.billing)}
                  </span>
                </button>
              ))}
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
              {levels.map((level) => {
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
