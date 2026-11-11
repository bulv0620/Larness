import { Input } from "@larness/ui";
import {
  browserSupportsWebAuthn,
  type PublicKeyCredentialCreationOptionsJSON,
  type RegistrationResponseJSON,
  startRegistration,
} from "@simplewebauthn/browser";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router";
import {
  ApiError,
  apiFetch,
  type PairingCreated,
  type PairingStatus,
  type RedeemEnrollmentResponse,
  type RedeemSessionResponse,
} from "@/lib/api";
import { useSession } from "./useAuth";

interface RegistrationOptions {
  challengeId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

type Stage = "creating" | "waiting" | "code" | "enrollment" | "error";

const PAIRING_STORAGE_KEY = "larness.pairing.request";

function clearStoredRequest(): void {
  try {
    window.sessionStorage.removeItem(PAIRING_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

function readStoredRequest(): PairingCreated | null {
  try {
    const raw = window.sessionStorage.getItem(PAIRING_STORAGE_KEY);

    if (raw === null) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PairingCreated>;
    const valid =
      typeof parsed.requestId === "string" &&
      typeof parsed.shortCode === "string" &&
      typeof parsed.pollToken === "string" &&
      typeof parsed.expiresAt === "number" &&
      parsed.expiresAt > Date.now() + 1_000;

    if (!valid) {
      clearStoredRequest();
      return null;
    }

    return parsed as PairingCreated;
  } catch {
    clearStoredRequest();
    return null;
  }
}

function storeRequest(request: PairingCreated): void {
  try {
    window.sessionStorage.setItem(PAIRING_STORAGE_KEY, JSON.stringify(request));
  } catch {
    // Pairing still works without refresh reuse.
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "NOT_INITIALIZED") {
      return "工作空间尚未初始化。请先在本机运行 pnpm run tui。";
    }
    if (error.code === "CODE_INVALID") {
      const attemptsLeft = (error.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
      return attemptsLeft === undefined
        ? "配对码不正确"
        : `配对码不正确，剩余 ${attemptsLeft} 次尝试`;
    }
    if (error.code === "PAIRING_DENIED") {
      return "本机已拒绝本次配对申请";
    }
    if (error.code === "PAIRING_EXPIRED") {
      return "配对申请或配对码已过期，请重新申请";
    }
    if (error.code === "RATE_LIMITED") {
      return "尝试过于频繁，请稍后再试";
    }
    if (error.code === "ENROLLMENT_EXPIRED") {
      return "Passkey 注册窗口已过期，请重新配对";
    }
    if (error.code === "ORIGIN_INVALID" || error.code === "WEBAUTHN_NOT_CONFIGURED") {
      return "当前来源不能注册 Passkey，请改用 localhost / HTTPS，或在 TUI 中选择“允许本次”";
    }
    if (error.code === "PASSKEY_REGISTRATION_FAILED") {
      return "Passkey 注册失败，请重试或重新配对";
    }
    return error.message;
  }

  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "已取消 Passkey 注册";
  }

  return error instanceof Error ? error.message : "操作失败";
}

export function PairPage() {
  const session = useSession();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [stage, setStage] = useState<Stage>("creating");
  const [request, setRequest] = useState<PairingCreated | null>(null);
  const [decision, setDecision] = useState<"allow_once" | "trust" | null>(null);
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<RedeemEnrollmentResponse | null>(null);
  const [registration, setRegistration] = useState<RegistrationOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const support = browserSupportsWebAuthn();

  useEffect(() => {
    if (session.data) {
      clearStoredRequest();
    }
  }, [session.data]);

  const createRequest = useCallback(async (): Promise<void> => {
    clearStoredRequest();
    setStage("creating");
    setError(null);
    setRequest(null);
    setEnrollment(null);
    setRegistration(null);
    setDecision(null);
    setCode("");

    try {
      const created = await apiFetch<PairingCreated>("/api/pairing/requests", {
        method: "POST",
        body: { clientLabel: navigator.userAgent.slice(0, 100) },
      });
      storeRequest(created);
      setRequest(created);
      setStage("waiting");
    } catch (requestError) {
      setError(errorMessage(requestError));
      setStage("error");
    }
  }, []);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    const stored = readStoredRequest();

    if (stored !== null) {
      setRequest(stored);
      setStage("waiting");
      return;
    }

    void createRequest();
  }, [createRequest]);

  useEffect(() => {
    if (stage !== "waiting" || request === null) {
      return;
    }

    let cancelled = false;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const status = await apiFetch<PairingStatus>(
            `/api/pairing/requests/${request.requestId}`,
            { headers: { "x-pairing-token": request.pollToken } },
          );

          if (cancelled) {
            return;
          }

          if (status.status === "approved") {
            setDecision(status.decision);
            setStage("code");
          } else if (status.status === "enrollment_pending") {
            setDecision("trust");
            setStage("enrollment");
          } else if (status.status === "denied") {
            clearStoredRequest();
            setError("本机已拒绝本次配对申请");
            setStage("error");
          } else if (status.status === "expired") {
            clearStoredRequest();
            setError("配对申请已过期，请重新申请");
            setStage("error");
          } else if (status.status === "redeemed") {
            clearStoredRequest();
            await queryClient.invalidateQueries({ queryKey: ["session"] });
            setStage("error");
            setError("该申请已完成配对，请返回工作台");
          }
        } catch (pollError) {
          if (!cancelled) {
            if (pollError instanceof ApiError && pollError.code === "NOT_FOUND") {
              clearStoredRequest();
            }
            setError(errorMessage(pollError));
            setStage("error");
          }
        }
      })();
    }, 2_000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stage, request, queryClient]);

  const loadRegistrationOptions = useCallback(async (): Promise<RegistrationOptions | null> => {
    try {
      const result = await apiFetch<RegistrationOptions>("/api/webauthn/registration/options", {
        method: "POST",
      });
      setRegistration(result);
      return result;
    } catch (optionsError) {
      setError(errorMessage(optionsError));
      return null;
    }
  }, []);

  useEffect(() => {
    if (stage === "enrollment" && support) {
      void loadRegistrationOptions();
    }
  }, [stage, support, loadRegistrationOptions]);

  if (session.data) {
    return <Navigate to="/" replace />;
  }

  const redeem = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();

    if (request === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await apiFetch<RedeemSessionResponse | RedeemEnrollmentResponse>(
        "/api/pairing/redeem",
        {
          method: "POST",
          body: { requestId: request.requestId, code: code.trim() },
        },
      );

      if (result.status === "session") {
        clearStoredRequest();
        await queryClient.invalidateQueries({ queryKey: ["session"] });
        await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
        setStage("error");
        setError("配对成功，正在进入工作台…");
        await queryClient.refetchQueries({ queryKey: ["session"] });
        return;
      }

      setEnrollment(result);
      setStage("enrollment");
    } catch (redeemError) {
      setError(errorMessage(redeemError));
    } finally {
      setBusy(false);
    }
  };

  const createPasskey = async (): Promise<void> => {
    if (registration === null) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response: RegistrationResponseJSON = await startRegistration({
        optionsJSON: registration.options,
      });
      await apiFetch("/api/webauthn/registration/verify", {
        method: "POST",
        body: { challengeId: registration.challengeId, response },
      });
      clearStoredRequest();
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
      setError("Passkey 已创建，正在进入工作台…");
      await queryClient.refetchQueries({ queryKey: ["session"] });
    } catch (registrationError) {
      setError(errorMessage(registrationError));

      if (
        registrationError instanceof ApiError &&
        (registrationError.code === "CHALLENGE_EXPIRED" ||
          registrationError.code === "PASSKEY_REGISTRATION_FAILED" ||
          registrationError.code === "ENROLLMENT_EXPIRED")
      ) {
        setRegistration(null);
        await loadRegistrationOptions();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10 text-ink">
      <section
        className="w-full max-w-[460px] rounded-[18px] border border-line bg-surface p-7 shadow-card"
        data-request-id={request?.requestId ?? ""}
        data-stage={stage}
      >
        <div className="mb-6 flex items-center gap-2">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-accent text-[13px] font-semibold text-accent-ink">
            L
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Larness</span>
        </div>

        <h1 className="text-lg font-semibold">配对这台浏览器</h1>
        <p className="mt-1 text-sm text-ink-2">申请需要在本机 TUI 中批准；配对码只显示一次。</p>

        {stage === "creating" ? <p className="mt-6 text-sm text-ink-2">正在创建配对申请…</p> : null}

        {stage === "waiting" && request ? (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-ink-3">短编号</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-[0.18em] text-ink">
              {request.shortCode}
            </p>
            <p className="mt-3 text-sm text-ink-2">
              等待本机 TUI 批准。批准后在此输入一次性配对码。
            </p>
            <button
              type="button"
              className="mt-4 text-sm text-accent hover:underline"
              onClick={() => void createRequest()}
            >
              重新申请
            </button>
          </div>
        ) : null}

        {stage === "code" && request ? (
          <form className="mt-6" onSubmit={(event) => void redeem(event)}>
            <p className="text-sm text-ink-2">
              已获批准（{decision === "trust" ? "始终允许，需要创建 Passkey" : "允许本次"}）。
              请输入 TUI 显示的配对码。
            </p>
            <label className="mt-4 block text-xs font-medium text-ink-2" htmlFor="pair-code">
              配对码
            </label>
            <Input
              id="pair-code"
              className="mt-1 h-11 px-3 font-mono text-lg tracking-[0.14em]"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              autoComplete="one-time-code"
            />
            <button
              type="submit"
              className="mt-4 flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
              disabled={busy || code.trim().length === 0}
            >
              {busy ? "正在兑换…" : "兑换配对码"}
            </button>
            <button
              type="button"
              className="mt-3 text-sm text-ink-2 hover:text-ink"
              onClick={() => void createRequest()}
            >
              重新申请
            </button>
          </form>
        ) : null}

        {stage === "enrollment" ? (
          <div className="mt-6">
            <p className="text-sm text-ink-2">
              配对码已兑换。必须在窗口过期前创建 Passkey，之后才能进入工作台。
            </p>
            {enrollment === null ? (
              <p className="mt-2 text-xs text-ink-3">已恢复同一配对申请的注册窗口。</p>
            ) : null}

            {!support ? (
              <p className="mt-3 rounded-md bg-surface-2 p-3 text-sm text-ink-2">
                当前浏览器不支持 WebAuthn。请重新配对，并在 TUI 中选择“允许本次”。
              </p>
            ) : null}

            {support ? (
              <button
                type="button"
                className="mt-4 flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition hover:opacity-90 disabled:opacity-50"
                disabled={busy || registration === null}
                onClick={() => void createPasskey()}
              >
                {busy ? "正在创建…" : registration === null ? "正在准备…" : "创建 Passkey"}
              </button>
            ) : null}

            <button
              type="button"
              className="mt-3 text-sm text-ink-2 hover:text-ink"
              onClick={() => void createRequest()}
            >
              重新配对
            </button>
          </div>
        ) : null}

        {stage === "error" ? (
          <div className="mt-6">
            <button
              type="button"
              className="mt-2 flex h-10 w-full items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-ink transition hover:opacity-90"
              onClick={() => void createRequest()}
            >
              重新申请
            </button>
            <Link className="mt-3 inline-block text-sm text-ink-2 hover:text-ink" to="/login">
              返回登录
            </Link>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {request ? (
          <p className="mt-5 text-xs text-ink-3">
            申请有效期至 {new Date(request.expiresAt).toLocaleTimeString()}
            ；配对码在其他设备上不显示。
          </p>
        ) : null}
      </section>
    </main>
  );
}
