import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Hint,
  IconButton,
} from "@harness/ui";
import { ArrowUp, ChevronDown, Plus, Shield, Sparkles, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSnapshot } from "@/lib/queries";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

const policies = [
  { id: "standard", label: "标准审批", detail: "L0/L1 自动，L2 询问" },
  { id: "strict", label: "严格审批", detail: "所有写入都询问" },
  { id: "readonly", label: "只读", detail: "禁止修改与执行" },
] as const;

export function Composer() {
  const { data } = useSnapshot();
  const draft = useComposerStore((state) => state.draft);
  const modelId = useComposerStore((state) => state.modelId);
  const policy = useComposerStore((state) => state.policy);
  const setDraft = useComposerStore((state) => state.setDraft);
  const setModelId = useComposerStore((state) => state.setModelId);
  const setPolicy = useComposerStore((state) => state.setPolicy);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const send = useTimelineStore((state) => state.send);
  const stop = useTimelineStore((state) => state.stop);
  const focusNonce = useNavigationStore((state) => state.focusComposerNonce);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const model = data.models.find((item) => item.id === modelId) ?? data.models[0];
  const currentPolicy = policies.find((item) => item.id === policy) ?? policies[0];

  useEffect(() => {
    if (focusNonce > 0) textareaRef.current?.focus();
  }, [focusNonce]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is the resize trigger
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(180, Math.max(24, element.scrollHeight))}px`;
  }, [draft]);

  const submit = () => {
    if (isStreaming) {
      stop();
      return;
    }
    const value = draft.trim();
    if (!value) return;
    void send(value);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="rounded-2xl border border-line bg-surface shadow-[0_2px_16px_rgba(15,23,42,.045)] transition-[border-color,box-shadow] focus-within:border-accent/35 focus-within:shadow-[0_0_0_4px_rgba(10,132,255,.08)]">
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        placeholder="描述任务，或粘贴日志 / 截图…"
        aria-label="对话输入"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }
        }}
        className="block max-h-[180px] min-h-[26px] w-full resize-none bg-transparent px-3.5 pt-3 text-[12.5px] leading-[1.6] text-ink outline-none placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
        <Hint label="添加上下文">
          <IconButton label="添加上下文" className="h-7 w-7">
            <Plus size={15} />
          </IconButton>
        </Hint>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
            >
              <Sparkles size={12} className="text-accent" />
              <span className="max-w-[128px] truncate">{model?.label ?? "选择模型"}</span>
              <ChevronDown size={11} className="text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[230px]">
            <DropdownMenuLabel>模型 · 下一轮生效</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={modelId} onValueChange={setModelId}>
              {data.models.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} className="items-start py-2">
                  <span className="flex flex-col">
                    <span className="text-[11.5px] font-medium text-ink">{item.label}</span>
                    <span className="text-[10px] text-ink-3">{item.detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-1 h-3 w-px bg-line" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
            >
              <Shield size={12} className="text-ink-3" />
              <span className="hidden sm:inline">{currentPolicy.label}</span>
              <ChevronDown size={11} className="text-ink-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[230px]">
            <DropdownMenuLabel>审批策略</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={policy}
              onValueChange={(value) => setPolicy(value as typeof policy)}
            >
              {policies.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} className="items-start py-2">
                  <span className="flex flex-col">
                    <span className="text-[11.5px] font-medium text-ink">{item.label}</span>
                    <span className="text-[10px] text-ink-3">{item.detail}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="ml-auto hidden font-mono text-[9.5px] text-ink-3 sm:inline">
          ~ 18k ctx
        </span>

        {isStreaming ? (
          <button
            type="button"
            onClick={submit}
            aria-label="停止执行"
            className="ml-1 flex h-7 items-center gap-1.5 rounded-full bg-danger/10 px-2.5 text-[11px] font-medium text-danger transition-colors hover:bg-danger/15"
          >
            <Square size={11} fill="currentColor" />
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="发送消息"
            className={cn(
              "ml-1 flex h-7 w-7 items-center justify-center rounded-full transition-all",
              draft.trim()
                ? "bg-accent text-white shadow-[0_2px_8px_rgba(10,132,255,.3)] hover:brightness-110 active:scale-95"
                : "bg-black/[.06] text-ink-3 dark:bg-white/[.08]",
            )}
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  );
}
