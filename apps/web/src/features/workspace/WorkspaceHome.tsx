import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useSession } from "@/features/auth/useAuth";
import { ApiError, apiFetch, setCsrfToken } from "@/lib/api";

function formatTime(value: number): string {
  return new Date(value).toLocaleString();
}

export function WorkspaceHome() {
  const session = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let opened = false;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

    socket.addEventListener("open", () => {
      opened = true;
    });
    socket.addEventListener("close", () => {
      if (opened && !disposed) {
        void queryClient.invalidateQueries({ queryKey: ["session"] });
        void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      }
    });
    socket.addEventListener("error", () => socket.close());

    return () => {
      disposed = true;
      socket.close();
    };
  }, [queryClient]);

  if (!session.data) {
    return null;
  }

  const data = session.data;
  const kindLabel = data.kind === "passkey" ? "可信设备 · Passkey" : "允许本次会话";

  const logout = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      await apiFetch("/api/auth/logout", { method: "POST", csrf: true });
      setCsrfToken(null);
      queryClient.clear();
      navigate("/", { replace: true });
    } catch (logoutError) {
      setError(logoutError instanceof ApiError ? logoutError.message : "退出登录失败");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setError(null);

    try {
      await apiFetch("/api/auth/session");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (refreshError) {
      setError(refreshError instanceof ApiError ? refreshError.message : "刷新会话失败");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink" data-testid="workspace-home">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-glass px-4 backdrop-blur">
        <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-accent-ink">
          L
        </span>
        <span className="text-[14px] font-semibold tracking-tight">Larness</span>
        <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2">
          {kindLabel}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md px-2.5 text-xs text-ink-2 transition hover:bg-surface-2 hover:text-ink"
            onClick={() => void refresh()}
            data-testid="refresh-session"
          >
            刷新会话
          </button>
          <button
            type="button"
            className="h-8 rounded-md bg-surface-2 px-3 text-xs font-medium text-ink transition hover:bg-surface-3 disabled:opacity-50"
            onClick={() => void logout()}
            disabled={busy}
            data-testid="logout-button"
          >
            {busy ? "正在退出…" : "退出登录"}
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-10">
        <section className="w-full max-w-[520px] rounded-[18px] border border-line bg-surface p-8 text-center shadow-card">
          <span className="mx-auto inline-flex size-11 items-center justify-center rounded-full bg-accent-soft text-lg text-accent">
            ✓
          </span>
          <h1 className="mt-4 text-xl font-semibold">工作空间已就绪</h1>
          <p className="mt-2 text-sm text-ink-2">
            认证与传输层已就绪。项目、会话与 Agent 将在 M1 接入；当前为空态工作台。
          </p>

          <dl className="mt-6 grid gap-2 rounded-md bg-surface-2 p-4 text-left text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">会话类型</dt>
              <dd className="font-medium">{kindLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-3">到期时间</dt>
              <dd className="font-medium">{formatTime(data.expiresAt)}</dd>
            </div>
            {data.kind === "passkey" ? (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-3">Backup</dt>
                <dd className="font-medium">
                  eligible={String(data.passkey?.backupEligible ?? false)} · state=
                  {String(data.passkey?.backupState ?? false)}
                </dd>
              </div>
            ) : null}
          </dl>

          {error ? (
            <p role="alert" className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
