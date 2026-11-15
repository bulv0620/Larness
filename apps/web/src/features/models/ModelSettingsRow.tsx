import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@larness/ui";
import { Eye, EyeOff, Info, Loader2, Play, Star } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { ApiCatalogModel } from "@/lib/workspaceApi";
import { ModelCapabilities } from "./ModelCapabilities";

export function ModelSettingsRow({
  model,
  isDefault,
  busy,
  verification,
  makeDefault,
  edit,
  verify,
  toggleVisibility,
}: {
  model: ApiCatalogModel;
  isDefault: boolean;
  busy: boolean;
  verification?: "testing" | "passed";
  makeDefault: () => void;
  edit: () => void;
  verify: () => void;
  toggleVisibility: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const defaultId = useId();
  const visible = model.visible !== false;
  const selectable = model.agentSelectable ?? model.contextWindow !== null;
  const unavailableReason = !selectable
    ? model.capabilities?.tools === false
      ? "不支持工具"
      : model.capabilities?.streaming === false
        ? "不支持流式"
        : model.contextWindow === null && model.capabilities?.maxInputTokens === undefined
          ? "待补上下文"
          : "暂不可选"
    : null;

  return (
    <li
      className="flex items-center gap-2 py-1.5"
      onContextMenu={(event) => {
        event.preventDefault();
        trigger.current?.focus({ preventScroll: true });
        setMenuOpen(true);
      }}
    >
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={model.label}
            aria-describedby={isDefault ? defaultId : undefined}
            onPointerDown={(event) => {
              if (event.button === 0 && event.pointerType === "mouse") event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
            className="flex min-w-0 items-center gap-1.5 rounded py-1 text-left text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className="truncate">{model.label}</span>
            {isDefault ? (
              <span
                id={defaultId}
                role="img"
                aria-label="新会话默认模型"
                className="shrink-0 text-accent"
              >
                <Star size={12} fill="currentColor" aria-hidden="true" />
              </span>
            ) : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={3} className="z-[350]">
          <DropdownMenuItem
            disabled={busy || !visible || !selectable || isDefault}
            onSelect={makeDefault}
          >
            <Star size={13} aria-hidden="true" />
            设为默认
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={edit}>
            <Info size={13} aria-hidden="true" />
            详情
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy || !selectable} onSelect={verify}>
            <Play size={13} aria-hidden="true" />
            测试调用
            {verification === "passed" ? (
              <span className="ml-auto text-[10px] text-ink-3">已验证</span>
            ) : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {unavailableReason ? (
          <span className="text-[10px] text-warning">{unavailableReason}</span>
        ) : null}
        {verification === "testing" ? (
          <span role="status" className="inline-flex items-center gap-1 text-[10px] text-ink-3">
            <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden="true" />
            测试中…
          </span>
        ) : verification === "passed" ? (
          <span role="status" className="sr-only">
            {model.label} 测试通过
          </span>
        ) : null}
        <ModelCapabilities model={model} />
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={visible}
          aria-label={`${model.label} 在会话中显示`}
          title={visible ? "从会话选择器隐藏" : "在会话选择器显示"}
          disabled={busy}
          onClick={toggleVisibility}
        >
          {visible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
        </Button>
      </div>
    </li>
  );
}
