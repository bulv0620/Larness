import { cn } from "@larness/ui";
import { Check, ChevronDown, KeyRound, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { billingLabel, providerLabel } from "@/features/models/catalogView";
import { ModelCapabilities } from "@/features/models/ModelCapabilities";
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
  const [expandedKey, setExpandedKey] = useState<string | null>();
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const availableGroups = groups.flatMap((group) => {
    const provider = providerLabel(group.provider);
    if (!query || `${group.credentialLabel} ${provider}`.toLowerCase().includes(query)) {
      return [group];
    }
    const models = group.models.filter((item) =>
      `${item.label} ${item.id}`.toLowerCase().includes(query),
    );
    return models.length ? [{ ...group, models }] : [];
  });
  const defaultExpandedKey =
    availableGroups.find((group) => group.credentialProfileId === credentialProfileId)
      ?.credentialProfileId ?? availableGroups[0]?.credentialProfileId;
  const mode = model?.thinking.mode;
  const levels = !model?.thinking.supported
    ? []
    : mode === "toggle"
      ? [
          { id: "off", label: "关闭" },
          { id: "on", label: "开启" },
        ]
      : [
          ...(mode === "mandatory-levels" ? [] : [{ id: "off", label: "关闭" }]),
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
          setExpandedKey(undefined);
          setSearch("");
          setOpen((current) => !current);
        }}
        className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="max-w-[96px] truncate sm:max-w-[144px]">{model?.label ?? "选择模型"}</span>
        {thinkingLabel ? (
          <span
            className={cn(
              "shrink-0 text-[10px] font-semibold",
              thinking === "off" ? "text-ink-3" : "text-accent",
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
          className="absolute bottom-[calc(100%+8px)] -left-5 z-40 flex max-h-[min(400px,55dvh)] w-[min(318px,calc(100vw-44px))] flex-col overflow-hidden rounded-xl border border-line bg-surface text-ink shadow-[var(--shadow-pop)] outline-none sm:left-0"
        >
          <label className="m-2 flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface-2/50 px-2.5 focus-within:border-accent/60">
            <Search size={13} aria-hidden="true" className="text-ink-3" />
            <input
              type="search"
              aria-label="搜索 Key 或模型"
              placeholder="搜索 Key 或模型"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setExpandedKey(undefined);
              }}
              className="h-8 w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-ink-3"
            />
          </label>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {availableGroups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-ink-3">
                {query
                  ? "没有匹配的 Key 或模型。"
                  : catalogError
                    ? "目录不可用，请在模型设置中刷新。"
                    : "请先在模型设置中添加 Key。"}
              </p>
            ) : null}
            {availableGroups.map((group) => {
              const currentKey = group.credentialProfileId === credentialProfileId;
              const expanded =
                expandedKey === undefined
                  ? Boolean(query) || group.credentialProfileId === defaultExpandedKey
                  : expandedKey === group.credentialProfileId;
              const groupId = `${panelId}-${group.credentialProfileId}`;
              return (
                <div
                  key={group.credentialProfileId}
                  className="rounded-lg border border-transparent has-[[aria-expanded=true]]:border-line"
                >
                  <button
                    type="button"
                    id={`${groupId}-trigger`}
                    aria-expanded={expanded}
                    aria-controls={expanded ? groupId : undefined}
                    onClick={() => setExpandedKey(expanded ? null : group.credentialProfileId)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40",
                      expanded && "rounded-b-none bg-surface-2/50",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-md bg-surface-2 text-ink-3",
                        currentKey && "bg-accent-soft text-accent",
                      )}
                    >
                      <KeyRound size={13} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {group.credentialLabel}
                      </span>
                      <span className="block truncate text-[10px] text-ink-3">
                        {providerLabel(group.provider)} · {billingLabel(group.billing)}
                      </span>
                    </span>
                    <ChevronDown
                      size={12}
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 text-ink-3 transition-transform",
                        !expanded && "-rotate-90",
                      )}
                    />
                  </button>

                  {expanded ? (
                    <ul
                      id={groupId}
                      aria-labelledby={`${groupId}-trigger`}
                      className="space-y-0.5 p-1"
                    >
                      {group.models.length === 0 ? (
                        <li className="px-2 py-2 text-[11px] text-ink-3">此 Key 暂无可选模型</li>
                      ) : null}
                      {group.models.map((item) => {
                        const selected = currentKey && item.id === model?.id;
                        return (
                          <li
                            key={item.id}
                            className={cn(
                              "flex items-center rounded-md pr-1",
                              selected && "bg-accent-soft",
                            )}
                          >
                            <button
                              type="button"
                              aria-pressed={selected}
                              onClick={() => {
                                close();
                                onSelectModel(item.id, group.credentialProfileId);
                              }}
                              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-2 text-left text-[11.5px] outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                            >
                              <span className="flex-1 truncate">{item.label}</span>
                              {selected ? (
                                <Check
                                  size={13}
                                  aria-hidden="true"
                                  className="shrink-0 text-accent"
                                />
                              ) : null}
                            </button>
                            <ModelCapabilities model={item} />
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })}
          </div>

          {levels.length > 0 ? (
            <fieldset
              aria-label="思考档位"
              className="flex shrink-0 flex-wrap items-center gap-1 border-t border-line px-2.5 py-2"
            >
              <span className="mr-auto text-[11px] text-ink-3">思考档位</span>
              {levels.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  aria-pressed={level.id === thinking}
                  onClick={() => {
                    close();
                    if (level.id !== thinking) onSelectThinking(level.id);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40",
                    level.id === thinking
                      ? "bg-accent-soft font-semibold text-accent"
                      : "text-ink-2",
                  )}
                >
                  {level.label}
                </button>
              ))}
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
