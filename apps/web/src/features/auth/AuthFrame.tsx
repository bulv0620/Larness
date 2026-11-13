import type { ReactNode } from "react";

export function AuthErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 text-ink">
      <section className="w-full max-w-[420px] rounded-[18px] border border-line bg-surface p-7 shadow-card">
        <h1 className="text-lg font-semibold">无法连接本机服务</h1>
        <p className="mt-2 text-sm text-ink-2">{message}</p>
        {onRetry ? (
          <button
            type="button"
            className="mt-5 h-10 rounded-md bg-accent px-4 text-sm font-medium text-accent-ink"
            onClick={onRetry}
          >
            重试
          </button>
        ) : null}
      </section>
    </main>
  );
}

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-10 text-ink">
      <section className="w-full max-w-[440px] rounded-[18px] border border-line bg-surface p-7 shadow-card">
        {children}
      </section>
    </main>
  );
}
