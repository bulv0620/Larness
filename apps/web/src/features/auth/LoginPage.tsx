import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialRequestOptionsJSON,
  startAuthentication,
} from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { ApiError, apiFetch } from "@/lib/api";
import { useBootstrap, useSession } from "./useAuth";

interface AuthenticationOptions {
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

function safeReturnTo(value: string | null): string {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  return value === "/login" ? "/" : value;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CHALLENGE_EXPIRED") {
      return "登录挑战已过期，请重试";
    }
    if (error.code === "PASSKEY_AUTH_FAILED") {
      return "Passkey 登录失败；如果设备已被撤销，请重新配对";
    }
    if (error.code === "WEBAUTHN_NOT_CONFIGURED" || error.code === "ORIGIN_INVALID") {
      return "当前来源不能使用 Passkey，请改用 localhost / HTTPS 或使用配对码";
    }
    return error.message;
  }

  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "已取消 Passkey 登录";
  }

  return error instanceof Error ? error.message : "登录失败";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const target = safeReturnTo(params.get("returnTo"));
  const bootstrap = useBootstrap();
  const session = useSession();
  const queryClient = useQueryClient();
  const [challenge, setChallenge] = useState<AuthenticationOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const support = browserSupportsWebAuthn();
  const originMatches =
    bootstrap.data !== undefined && window.location.origin === bootstrap.data.auth.passkeyOrigin;
  const usable =
    bootstrap.data !== undefined &&
    bootstrap.data.initialized &&
    bootstrap.data.auth.passkeyEnabled &&
    originMatches &&
    support;

  const loadOptions = useCallback(async (): Promise<AuthenticationOptions | null> => {
    try {
      const result = await apiFetch<AuthenticationOptions>("/api/webauthn/authentication/options", {
        method: "POST",
      });
      setChallenge(result);
      return result;
    } catch (optionsError) {
      setError(messageFor(optionsError));
      return null;
    }
  }, []);

  useEffect(() => {
    if (usable) {
      void loadOptions();
    }
  }, [usable, loadOptions]);

  if (session.data) {
    return <Navigate to={target} replace />;
  }

  const login = async (): Promise<void> => {
    setBusy(true);
    setError(null);

    try {
      const current = challenge ?? (await loadOptions());

      if (current === null) {
        return;
      }

      const response = await startAuthentication({ optionsJSON: current.options });
      await apiFetch("/api/webauthn/authentication/verify", {
        method: "POST",
        body: { challengeId: current.challengeId, response },
      });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
    } catch (loginError) {
      setError(messageFor(loginError));

      if (loginError instanceof ApiError && loginError.code === "CHALLENGE_EXPIRED") {
        setChallenge(null);
        await loadOptions();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10 text-ink">
      <section className="w-full max-w-[420px] rounded-[18px] border border-line bg-surface p-7 shadow-card">
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-accent-ink">
            L
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Larness</span>
          <span className="ml-auto text-xs text-ink-3">{bootstrap.data?.app.version}</span>
        </div>

        <h1 className="text-lg font-semibold">使用 Passkey 登录</h1>
        <p className="mt-1 text-sm text-ink-2">使用 Face ID、指纹或系统 PIN 解锁当前工作空间。</p>

        {!bootstrap.data ? (
          <p className="mt-6 text-sm text-ink-2">
            {bootstrap.isError ? "无法连接本机服务" : "正在读取工作空间状态…"}
          </p>
        ) : null}

        {bootstrap.data && !bootstrap.data.initialized ? (
          <p className="mt-6 rounded-md bg-surface-2 p-3 text-sm text-ink-2">
            工作空间尚未初始化。请先在本机运行 <code>pnpm run tui</code> 完成初始化。
          </p>
        ) : null}

        {bootstrap.data && bootstrap.data.initialized && !originMatches ? (
          <p className="mt-6 rounded-md bg-surface-2 p-3 text-sm text-ink-2">
            当前来源 <code>{window.location.origin}</code> 不是 canonical origin{" "}
            <code>{bootstrap.data.auth.passkeyOrigin}</code>。请改用 localhost 或 HTTPS
            域名，或使用下方的“使用配对码”入口。
          </p>
        ) : null}

        {bootstrap.data && bootstrap.data.initialized && originMatches && !support ? (
          <p className="mt-6 rounded-md bg-surface-2 p-3 text-sm text-ink-2">
            当前浏览器不支持 WebAuthn / Passkey，请使用配对码入口。
          </p>
        ) : null}

        {bootstrap.data && bootstrap.data.initialized && !bootstrap.data.auth.passkeyEnabled ? (
          <p className="mt-6 rounded-md bg-surface-2 p-3 text-sm text-ink-2">
            WebAuthn 配置无效（RP ID / Origin），Passkey 不可用；请使用配对码入口。
          </p>
        ) : null}

        {usable ? (
          <button
            type="button"
            className="mt-6 flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || challenge === null}
            onClick={() => void login()}
          >
            {busy ? "正在验证…" : challenge === null ? "正在准备…" : "使用 Passkey 登录"}
          </button>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between text-sm">
          <Link className="text-accent hover:underline" to="/pair">
            使用配对码
          </Link>
          {usable && challenge === null ? (
            <button
              type="button"
              className="text-ink-2 hover:text-ink"
              onClick={() => void loadOptions()}
            >
              重试准备
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
