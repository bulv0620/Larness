import type { FileScope } from "@larness/shared";
import { ConfirmDialog } from "@larness/ui";
import { type ReactNode, useState } from "react";
import { queryClient } from "@/lib/queries";
import { createTerminal, openTerminal } from "./api";

export function CreateTerminalButton({
  scope,
  label = "新建终端",
  children,
  className,
}: {
  scope: FileScope;
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const [request, setRequest] = useState<{ key: string; scope: FileScope } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        aria-label={label}
        title="新建终端"
        className={className}
        onClick={() => {
          setError("");
          setRequest({ key: crypto.randomUUID(), scope });
        }}
      >
        {children ?? "新建终端"}
      </button>
      <ConfirmDialog
        open={request !== null}
        title="创建终端确认"
        description="终端以本机账户权限运行，可访问项目外文件。"
        confirmLabel="确认创建"
        pendingLabel="正在创建…"
        pending={busy}
        error={error}
        onDismissError={() => setError("")}
        onCancel={() => setRequest(null)}
        onConfirm={async () => {
          if (!request || busy) return;
          setBusy(true);
          setError("");
          try {
            const item = await createTerminal(request.scope, request.key);
            openTerminal(item);
            setRequest(null);
            void queryClient.invalidateQueries({ queryKey: ["terminals"] });
          } catch {
            setError("创建结果未确认，请重试核对；重试不会重复创建。");
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
