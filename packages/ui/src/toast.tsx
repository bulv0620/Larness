import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./button";
import { cn } from "./cn";

export type ToastTone = "success" | "info" | "error";

export interface ToastProps {
  /** `null` hides the toast. A changed message resets dismissal and restarts the timer. */
  message: string | null;
  tone?: ToastTone;
  /**
   * Auto-dismiss delay in ms. Defaults to 3200 for success/info and 0 for
   * errors, so failures stay visible until the user closes them.
   */
  durationMs?: number;
  retry?: { label: string; run: () => void };
  onDismiss?: () => void;
}

const ICONS = {
  success: CircleCheck,
  info: Info,
  error: CircleAlert,
} as const;

const ICON_TONES = {
  success: "text-success",
  info: "text-accent",
  error: "text-danger",
} as const;

/**
 * 提示层：视口顶部居中、位于 48px 全局顶栏之下（`top-14`），层级高于窗口层
 * （`z-40` 堆叠上下文）、弹窗（`z-[300]` / `z-[311]`）与附件预览（`z-[340]`）。
 */
const TOAST_LAYER_CLASS =
  "pointer-events-none fixed inset-x-0 top-14 z-[360] flex flex-col items-center gap-2 px-4";

const TOAST_LAYER_ATTRIBUTE = "data-larness-toast-layer";

let globalLayer: HTMLElement | null = null;

function toastLayer(): HTMLElement {
  const layer = findLayer();
  // 每次挂载都重写类名：热更新或旧版本残留的同名节点可能带着过期的偏移与层级，
  // 只复用节点而不刷新样式，会让 `top-4` 时期的层继续被顶栏盖住。
  layer.className = TOAST_LAYER_CLASS;
  return layer;
}

function findLayer(): HTMLElement {
  if (globalLayer?.isConnected) return globalLayer;
  const existing = document.querySelector<HTMLElement>(`[${TOAST_LAYER_ATTRIBUTE}]`);
  if (existing) {
    globalLayer = existing;
    return existing;
  }
  const layer = document.createElement("div");
  layer.setAttribute(TOAST_LAYER_ATTRIBUTE, "");
  document.body.append(layer);
  globalLayer = layer;
  return layer;
}

const ToastHostContext = createContext<HTMLElement | null>(null);

/**
 * 浮层内的提示宿主：把 `Toast` 挂进当前浮层（例如模态弹窗）内部，避免被 Radix 的
 * `aria-hidden` 与焦点陷阱挡在外面。没有宿主时提示挂到 `document.body` 的全局层。
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  return (
    <ToastHostContext.Provider value={host}>
      {/* 宿主层必须排在 children 之前：它是 `fixed` 脱离文档流，但仍是 DOM 子元素。
          Tailwind v4 的 `space-y-*` 用 `:not(:last-child)` 加 `margin-block-end`，
          宿主排在最后会让调用方的最后一块（如弹窗底部按钮行）多出一段尾距。 */}
      <div ref={setHost} data-larness-toast-host="" className={TOAST_LAYER_CLASS} />
      {children}
    </ToastHostContext.Provider>
  );
}

/**
 * Single transient-feedback surface for the whole app: a top-center floating
 * message that never takes layout space. Use the `error` tone (or the
 * `ErrorMessage` alias) for failures, `success` for completed actions and
 * `info` for neutral status. Field-level validation and panel state belong
 * inline; see `docs/architecture/ui-feedback.md`.
 */
export function Toast(props: ToastProps) {
  const host = useContext(ToastHostContext);
  if (!props.message) return null;
  const body = <ToastBody key={props.message} {...props} message={props.message} />;
  // 必须挂到全局层：调用点常位于窗口、输入区等 `z-index` 堆叠上下文内部，
  // 就地渲染会被顶栏、窗口与弹窗盖住。
  if (typeof document === "undefined") return body;
  return createPortal(body, host ?? toastLayer());
}

function ToastBody({
  message,
  tone = "success",
  durationMs,
  retry,
  onDismiss,
}: ToastProps & { message: string }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [dismissed, setDismissed] = useState(false);
  const delay = durationMs ?? (tone === "error" ? 0 : 3200);

  useEffect(() => {
    if (delay <= 0) return;
    const timer = window.setTimeout(() => {
      setDismissed(true);
      dismissRef.current?.();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  if (dismissed) return null;

  const Icon = ICONS[tone];
  const persistent = delay <= 0;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "toast-slide-in pointer-events-none flex w-max max-w-[min(28rem,100%)]",
        "items-center gap-2 rounded-xl border bg-surface px-3 py-2 text-[12px] leading-5 text-ink shadow-[var(--shadow-pop)]",
        tone === "error" ? "border-danger/30" : "border-line",
      )}
    >
      <Icon size={13} aria-hidden="true" className={cn("shrink-0", ICON_TONES[tone])} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{message}</span>
      {retry ? (
        <Button
          size="sm"
          variant="secondary"
          className="pointer-events-auto shrink-0"
          onClick={retry.run}
        >
          {retry.label}
        </Button>
      ) : null}
      {persistent ? (
        <Button
          size="sm"
          variant="ghost"
          className="pointer-events-auto shrink-0"
          aria-label={tone === "error" ? "关闭错误消息" : "关闭提示"}
          onClick={() => {
            setDismissed(true);
            onDismiss?.();
          }}
        >
          关闭
        </Button>
      ) : null}
    </div>
  );
}
