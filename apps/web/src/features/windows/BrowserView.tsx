import { cn, IconButton } from "@larness/ui";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type PreviewSession, resolvePreview } from "@/features/services/api";
import { ApiError } from "@/lib/api";
import { USE_MOCKS } from "@/lib/env";
import type { WindowTab } from "@/lib/windowTypes";

export function BrowserView({ tab }: { tab: WindowTab }) {
  if (!USE_MOCKS && tab.browser) return <PreviewBrowser tab={tab} />;
  return <MockBrowser tab={tab} />;
}

function previewError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message;
  return cause instanceof Error ? cause.message : "预览不可用";
}

function PreviewBrowser({ tab }: { tab: WindowTab }) {
  const browser = tab.browser;
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [openingExternal, setOpeningExternal] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const frameName = `preview-${tab.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  useEffect(() => {
    if (!browser) return;
    let cancelled = false;
    const attempt = nonce;
    setLoading(true);
    setError("");
    setSession(null);
    resolvePreview(browser.serviceId, browser.path)
      .then((value) => {
        if (cancelled || attempt !== nonce) return;
        setSession(value);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled || attempt !== nonce) return;
        setError(previewError(cause));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browser, nonce]);

  useEffect(() => {
    if (session) formRef.current?.submit();
  }, [session]);

  const openExternal = async () => {
    if (!browser || openingExternal) return;
    setOpeningExternal(true);
    setError("");
    const target = window.open("about:blank", "_blank");
    try {
      if (!target) throw new Error("浏览器阻止了新窗口");
      target.opener = null;
      const value = await resolvePreview(browser.serviceId, browser.path, "external");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = value.bootstrapUrl;
      form.target = `preview-external-${Date.now()}`;
      target.name = form.target;
      form.style.display = "none";
      for (const [name, val] of [
        ["ticket", value.ticket],
        ["path", browser.path],
      ] as const) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = val;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
      form.remove();
    } catch (cause) {
      target?.close();
      setError(previewError(cause));
    } finally {
      setOpeningExternal(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface-2/45 px-2">
        <IconButton label="后退" disabled className="h-6 w-6">
          <ArrowLeft size={13} />
        </IconButton>
        <IconButton label="前进" disabled className="h-6 w-6">
          <ArrowRight size={13} />
        </IconButton>
        <IconButton
          label="刷新预览"
          onClick={() => setNonce((value) => value + 1)}
          className="h-6 w-6"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
        </IconButton>
        <div className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-surface px-2">
          <ShieldCheck size={11} className="shrink-0 text-success" />
          <span
            title="预览地址"
            className="h-full min-w-0 flex-1 truncate font-mono text-[10.5px] leading-7 text-ink-2"
          >
            {session ? `${session.origin}${browser?.path ?? "/"}` : "解析预览来源…"}
          </span>
          {loading ? <Loader2 size={11} className="animate-spin text-ink-3" /> : null}
        </div>
        <IconButton
          label="在独立来源打开"
          onClick={() => void openExternal()}
          disabled={openingExternal}
          className="h-6 w-6"
        >
          <ExternalLink size={12} />
        </IconButton>
      </div>

      <div className="relative min-h-0 flex-1 bg-white">
        {error ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface text-center">
            <p role="alert" title={error} className="max-w-[360px] px-4 text-[12px] text-ink-2">
              无法访问
            </p>
            <button
              type="button"
              className="text-[11px] text-accent underline"
              onClick={() => setNonce((value) => value + 1)}
            >
              刷新
            </button>
          </div>
        ) : null}
        <form
          ref={formRef}
          method="POST"
          action={session?.bootstrapUrl ?? ""}
          target={frameName}
          hidden
        >
          <input type="hidden" name="ticket" value={session?.ticket ?? ""} readOnly />
        </form>
        <iframe
          name={frameName}
          title="项目预览"
          data-testid="preview-frame"
          src="about:blank"
          sandbox="allow-scripts allow-forms allow-same-origin"
          referrerPolicy="no-referrer"
          className="h-full w-full border-0 bg-white"
        />
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-[11px] text-ink-3">
            正在建立隔离预览…
          </div>
        ) : null}
      </div>

      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-line bg-surface-2/50 px-2 font-mono text-[9px] text-ink-3">
        <Globe2 size={10} className="shrink-0" />
        <span className="whitespace-nowrap">独立来源</span>
      </div>
    </div>
  );
}

function MockBrowser({ tab }: { tab: WindowTab }) {
  const [address, setAddress] = useState(
    tab.resourceId.startsWith("http") ? tab.resourceId : "http://localhost:5173/dashboard",
  );
  const [loading, setLoading] = useState(false);

  const refresh = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 650);
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line bg-surface-2/45 px-2">
        <IconButton label="后退" disabled className="h-6 w-6">
          <ArrowLeft size={13} />
        </IconButton>
        <IconButton label="前进" disabled className="h-6 w-6">
          <ArrowRight size={13} />
        </IconButton>
        <IconButton label="刷新" onClick={refresh} className="h-6 w-6">
          <RefreshCw size={12} className={loading ? "animate-spin" : undefined} />
        </IconButton>
        <form
          className="mx-1 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-surface px-2"
          onSubmit={(event) => {
            event.preventDefault();
            refresh();
          }}
        >
          <ShieldCheck size={11} className="shrink-0 text-success" />
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-label="预览地址"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[10.5px] text-ink-2 outline-none"
          />
          {loading ? <Loader2 size={11} className="animate-spin text-ink-3" /> : null}
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[#f7f8fa]">
        <MockSite address={address} />
      </div>

      <div className="flex h-6 shrink-0 items-center gap-1.5 border-t border-line bg-surface-2/50 px-2 font-mono text-[9px] text-ink-3">
        <Globe2 size={10} className="shrink-0" />
        <span className="whitespace-nowrap">演示预览</span>
      </div>
    </div>
  );
}

function MockSite({ address }: { address: string }) {
  return (
    <div className="min-h-full bg-[#f7f8fa] text-[#1d1d1f]">
      <div className="border-b border-black/[.06] bg-white/80 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[900px] items-center gap-3">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#0a84ff] text-[10px] font-bold text-white">
            L
          </div>
          <span className="text-[12px] font-semibold">Larness</span>
          <nav className="ml-4 flex items-center gap-4 text-[10.5px] text-[#6e6e73]">
            <span className="text-[#1d1d1f]">概览</span>
            <span>项目</span>
            <span>运行记录</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full bg-[#30d158]/10 px-2 py-[2px] text-[9px] font-medium text-[#1f9d48]">
              dev · healthy
            </span>
            <div className="h-6 w-6 rounded-full bg-[#ffd60a]" />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[900px] px-6 py-8">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[.12em] text-[#86868b]">
              Workspace overview
            </p>
            <h2 className="mt-2 text-[28px] font-semibold tracking-[-.03em]">
              你的工作空间，已就绪。
            </h2>
            <p className="mt-1.5 max-w-[520px] text-[12px] leading-5 text-[#6e6e73]">
              这是 Vite 开发服务的本地预览占位页面。真实项目会在独立来源中加载，不共享管理站的
              Cookie。
            </p>
          </div>
          <div className="hidden rounded-xl border border-black/[.06] bg-white px-3 py-2 text-right shadow-sm sm:block">
            <div className="font-mono text-[9px] text-[#86868b]">{address}</div>
            <div className="mt-1 text-[10px] text-[#1f9d48]">HTTP 200 · 42ms</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "运行中的服务", value: "3", detail: "+1 今日", tint: "#0a84ff" },
            { label: "本周部署", value: "12", detail: "全部健康", tint: "#30d158" },
            { label: "终端会话", value: "2", detail: "1 个空闲", tint: "#ff9f0a" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-black/[.06] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,.03)]"
            >
              <div className="text-[10px] text-[#86868b]">{card.label}</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[26px] font-semibold leading-none tracking-[-.04em]">
                  {card.value}
                </span>
                <span className="pb-0.5 text-[9.5px] text-[#6e6e73]">{card.detail}</span>
              </div>
              <div className="mt-3 h-1 rounded-full bg-black/[.05]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: card.label === "运行中的服务" ? "62%" : "78%",
                    background: card.tint,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-[1.4fr_1fr] gap-3">
          <div className="rounded-2xl border border-black/[.06] bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">最近活动</span>
              <span className="text-[9.5px] text-[#86868b]">过去 24 小时</span>
            </div>
            <div className="mt-3 flex h-[92px] items-end gap-1.5">
              {[38, 52, 44, 66, 58, 74, 62, 80, 68, 86, 72, 92].map((height, index) => (
                <div
                  key={index}
                  className={cn(
                    "flex-1 rounded-t-[3px]",
                    index === 11 ? "bg-[#0a84ff]" : "bg-[#0a84ff]/20",
                  )}
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-black/[.06] bg-white p-4">
            <div className="text-[11px] font-semibold">当前会话</div>
            <div className="mt-3 space-y-2">
              {[
                ["feat/agent-runtime", "feat/agent-runtime", "运行中"],
                ["web-prod", "PM2 · 8080", "待部署"],
                ["preview", "localhost:5173", "已连接"],
              ].map(([title, meta, status]) => (
                <div key={title} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#0a84ff]" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10.5px] font-medium">{title}</div>
                    <div className="truncate font-mono text-[9px] text-[#86868b]">{meta}</div>
                  </div>
                  <span className="text-[9px] text-[#6e6e73]">{status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-black/[.05] py-4 text-[9px] text-[#86868b]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#30d158]" />
        这是 S0 视觉 Demo 的静态预览，不加载真实项目页面
      </div>
    </div>
  );
}
