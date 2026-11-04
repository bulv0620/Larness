import type { FileResultTarget } from "@larness/shared";
import { useState } from "react";
import { openFile } from "./actions";
import { fileError } from "./api";
export function FileResultCard({ target }: { target: FileResultTarget }) {
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="py-1 text-[12px] text-ink-2">
      <button
        type="button"
        className="break-all text-left text-accent underline decoration-accent/30 underline-offset-4 hover:decoration-accent"
        disabled={pending}
        onClick={() => {
          setPending(true);
          setError(null);
          void openFile(target.scope, target.path, "agent")
            .then((doc) =>
              setChanged(target.version !== undefined && target.version !== doc.version),
            )
            .catch((error: unknown) => setError(fileError(error)))
            .finally(() => setPending(false));
        }}
      >
        查看文件 · {target.path}
      </button>
      {changed ? <p role="status">文件已变化，已打开当前版本。</p> : null}
      {error ? (
        <p role="alert" className="mt-1 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
