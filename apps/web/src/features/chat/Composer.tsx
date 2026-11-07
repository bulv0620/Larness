import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
} from "@larness/ui";
import { ArrowUp, Plus, Shield, ShieldAlert, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { pendingApprovals } from "@/lib/pendingApprovals";
import { useModelCatalog, useSessionModel } from "@/lib/queries";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";
import { ModelControl } from "./ModelControl";

const policies = [
  {
    id: "standard",
    label: "标准审批",
    detail: "L0/L1 自动，L2 询问",
    icon: ShieldCheck,
    tone: "text-accent",
  },
  {
    id: "strict",
    label: "严格审批",
    detail: "所有写入都询问",
    icon: ShieldAlert,
    tone: "text-warning",
  },
  {
    id: "autonomous",
    label: "完全自主",
    detail: "所有工具免人工审批",
    icon: ShieldAlert,
    tone: "text-danger",
  },
  { id: "readonly", label: "只读", detail: "禁止修改与执行", icon: Shield, tone: "text-success" },
] as const;

export function Composer() {
  const [confirmAutonomous, setConfirmAutonomous] = useState(false);
  const { catalog, error: catalogError } = useModelCatalog();
  const draft = useComposerStore((state) => state.draft);
  const modelId = useComposerStore((state) => state.modelId);
  const thinking = useComposerStore((state) => state.thinking);
  const policy = useComposerStore((state) => state.policy);
  const setDraft = useComposerStore((state) => state.setDraft);
  const setModelId = useComposerStore((state) => state.setModelId);
  const setThinking = useComposerStore((state) => state.setThinking);
  const setPolicy = useComposerStore((state) => state.setPolicy);
  const isStreaming = useTimelineStore((state) => state.isStreaming);
  const send = useTimelineStore((state) => state.send);
  const stop = useTimelineStore((state) => state.stop);
  const focusNonce = useNavigationStore((state) => state.focusComposerNonce);
  const hasSession = useNavigationStore((state) => Boolean(state.sessionId));
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessionId = useNavigationStore((state) => state.sessionId);
  const sessionDetail = useSessionModel(sessionId);
  const hydratedSession = useRef<string | null>(null);
  const catalogModels = catalog?.models ?? [];
  const model = catalogModels.find((item) => item.id === modelId) ?? catalogModels[0];
  const currentPolicy = policies.find((item) => item.id === policy) ?? policies[0];
  const PolicyIcon = currentPolicy.icon;
  const modelUsage = useTimelineStore((state) => state.modelUsage);
  const usage = model ? modelUsage[model.id] : undefined;
  const pendingApproval = useTimelineStore((state) => pendingApprovals(state.items).length > 0);

  useEffect(() => {
    if (focusNonce > 0) textareaRef.current?.focus();
  }, [focusNonce]);

  useEffect(() => {
    if (sessionDetail === null || sessionDetail.id === hydratedSession.current) return;
    hydratedSession.current = sessionDetail.id;
    if (sessionDetail.model) setModelId(sessionDetail.model);
    if (sessionDetail.thinking) {
      setThinking(sessionDetail.thinking === "default" ? "medium" : sessionDetail.thinking);
    }
  }, [sessionDetail, setModelId, setThinking]);

  useEffect(() => {
    if (catalogModels.length > 0 && !catalogModels.some((item) => item.id === modelId)) {
      const first = catalogModels[0];
      setModelId(first?.id ?? modelId);
      setThinking(first?.thinking.supported ? "medium" : "off");
    }
  }, [catalogModels, modelId, setModelId, setThinking]);

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

  const selectModel = (nextModelId: string) => {
    setModelId(nextModelId);
    const next = catalogModels.find((item) => item.id === nextModelId);

    if (next !== undefined && !next.thinking.supported) {
      setThinking("off");
    }
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
    <div className="rounded-[18px] border border-line bg-surface shadow-[var(--shadow-card)] transition-[border-color,box-shadow] focus-within:border-accent/35 focus-within:ring-2 focus-within:ring-accent/10">
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

        <ModelControl
          models={catalogModels}
          model={model}
          thinking={thinking}
          catalogError={catalogError}
          credentialLabel={catalog?.credentialLabel}
          onSelectModel={selectModel}
          onSelectThinking={setThinking}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              label={`审批策略：${currentPolicy.label}`}
              title={`${currentPolicy.label} · ${currentPolicy.detail}`}
              className="h-7 w-7"
            >
              <PolicyIcon size={15} className={currentPolicy.tone} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[230px]">
            <DropdownMenuLabel>审批策略</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={policy}
              onValueChange={(value) => {
                if (value === "autonomous" && policy !== "autonomous") setConfirmAutonomous(true);
                else if (policies.some((item) => item.id === value))
                  setPolicy(value as typeof policy);
              }}
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
        <ContextUsage
          used={usage?.inputTokens ?? null}
          limit={usage?.contextWindow ?? model?.contextWindow ?? 128000}
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            aria-label="停止执行"
            className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-danger/10 text-danger transition-colors hover:bg-danger/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
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
              "ml-1 flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
              draft.trim() && hasSession && model !== undefined && !pendingApproval
                ? "bg-accent text-white shadow-[var(--shadow-card)] hover:brightness-110 active:brightness-95"
                : "bg-black/[.06] text-ink-3 dark:bg-white/[.08]",
            )}
          >
            <ArrowUp size={15} strokeWidth={2.2} />
          </button>
        )}
      </div>
      <Dialog open={confirmAutonomous} onOpenChange={setConfirmAutonomous}>
        <DialogContent className="space-y-4 text-sm">
          <DialogTitle>启用完全自主？</DialogTitle>
          <DialogDescription>
            Agent 将不再逐次请求工具审批，可自行修改或删除文件、执行命令、进行 Git
            推送等操作。程序以本机账户权限运行，这不是沙箱。请仅在信任当前任务时启用；下一轮生效，随时可以切回标准审批。
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmAutonomous(false)}>
              取消
            </Button>
            <Button
              className="bg-danger text-white"
              onClick={() => {
                setPolicy("autonomous");
                setConfirmAutonomous(false);
              }}
            >
              确认启用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContextUsage({ used, limit }: { used: number | null; limit: number }) {
  const known = used !== null && Number.isFinite(used) && used > 0 && limit > 0;
  const percent = known ? Math.min(100, Math.max(0, Math.round((used / limit) * 100))) : 0;
  const detail = known
    ? `单次输入：${used.toLocaleString()} / ${limit.toLocaleString()} tokens（${percent}%）`
    : `暂无统计 · 模型窗口 ${limit.toLocaleString()} tokens`;
  return (
    <div
      role="progressbar"
      aria-label="上下文用量"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? percent : undefined}
      aria-valuetext={detail}
      title={detail}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center",
        !known
          ? "text-ink-3"
          : percent >= 90
            ? "text-danger"
            : percent >= 75
              ? "text-warning"
              : "text-accent",
      )}
    >
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 20 20"
        className="-rotate-90"
        fill="none"
      >
        <circle
          cx="10"
          cy="10"
          r="7"
          stroke="currentColor"
          strokeWidth="2"
          className="text-line-strong"
        />
        {known ? (
          <circle
            cx="10"
            cy="10"
            r="7"
            pathLength="100"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="100"
            strokeDashoffset={100 - percent}
            className="transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
          />
        ) : null}
      </svg>
    </div>
  );
}
