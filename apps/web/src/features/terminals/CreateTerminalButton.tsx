import type { FileScope } from "@larness/shared";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
} from "@larness/ui";
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
      <Dialog
        open={request !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRequest(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle>创建终端确认</DialogTitle>
          <DialogDescription>终端以本机账户运行，项目目录不是沙箱。</DialogDescription>
          <ErrorMessage message={error} onDismiss={() => setError("")} />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => setRequest(null)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
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
            >
              {busy ? "正在创建…" : "确认创建"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
