import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
} from "@larness/ui";
import { ArrowUp, ChevronDown, MoreHorizontal, Plus, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { pendingApprovals } from "@/lib/pendingApprovals";
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
  const hasSession = useNavigationStore((state) => Boolean(state.sessionId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const model = data.models.find((item) => item.id === modelId) ?? data.models[0];
  const contextTokens = useTimelineStore((state) => state.contextTokens);
  const pendingApproval = useTimelineStore((state) => pendingApprovals(state.items).length > 0);

  useEffect(() => {
    if (focusNonce > 0) textareaRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    if (data.models.length > 0 && !data.models.some((item) => item.id === modelId)) {
      setModelId(data.models[0]?.id ?? modelId);
    }
  }, [data.models, modelId, setModelId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: draft is the resize trigger
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(180, Math.max(48, element.scrollHeight))}px`;
  }, [draft]);

  const appendContext = (token: string) => {
    const separator = draft && !draft.endsWith(" ") ? " " : "";
    setDraft(`${draft}${separator}${token} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const submit = () => {
    if (!hasSession || model === undefined) return;
    if (isStreaming || pendingApproval) return;
    const value = draft.trim();
    if (!value) return;
    void send(value);
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  return (
    <div className="rounded-[18px] border border-line bg-surface shadow-sm focus-within:border-ink-3/40">
      <textarea
        ref={textareaRef}
        value={draft}
        rows={1}
        placeholder={hasSession ? "继续对话，或提出新的任务…" : "新建或选择一个会话…"}
        aria-label="对话输入"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!isStreaming) submit();
          }
        }}
        className="block max-h-[180px] min-h-[48px] w-full resize-none bg-transparent px-3.5 pt-3 text-[13px] leading-[1.65] text-ink outline-none placeholder:text-ink-3 focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="添加上下文" className="h-7 w-7">
              <Plus size={15} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[220px]">
            <DropdownMenuLabel>添加上下文</DropdownMenuLabel>
            {["@README.md", "@package.json", "@apps/web/src/app/AppShell.tsx"].map((token) => (
              <DropdownMenuItem
                key={token}
                onSelect={() => appendContext(token)}
                className="font-mono text-[10.5px]"
              >
                {token}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-7 items-center gap-1.5 rounded-lg px-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-black/[.045] hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 dark:hover:bg-white/[.06]"
            >
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="更多对话设置" className="h-7 w-7">
              <MoreHorizontal size={15} />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[230px]">
            <DropdownMenuLabel>
              上下文 {contextTokens.toLocaleString()} /{" "}
              {(model?.maxContextTokens ?? 128000).toLocaleString()}
            </DropdownMenuLabel>
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

        <span className="flex-1" />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="停止执行"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-ink text-surface"
          >
            <Square size={11} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || !hasSession || model === undefined || pendingApproval}
            aria-label="发送消息"
            className={cn(
              "ml-1 flex h-7 w-7 items-center justify-center rounded-full transition-all",
              draft.trim() && hasSession && model !== undefined && !pendingApproval
                ? "bg-ink text-surface hover:opacity-80"
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
