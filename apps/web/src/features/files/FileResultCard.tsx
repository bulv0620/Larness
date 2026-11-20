import type { FileResultTarget } from "@larness/shared";
import { Toast } from "@larness/ui";
import { FileText } from "lucide-react";
import { useState } from "react";
import { ResultCard } from "@/features/chat/ResultCard";
import { openFile } from "./actions";
import { fileError } from "./api";

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function FileResultCard({ target }: { target: FileResultTarget }) {
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <div className="min-w-0">
      <ResultCard
        icon={FileText}
        label={`文件 · ${fileName(target.path)}`}
        ariaLabel={`查看文件 · ${target.path}`}
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
      />
      <Toast
        message={error ?? (changed ? "文件已变化，已打开当前版本。" : null)}
        tone={error ? "error" : "success"}
        onDismiss={() => (error ? setError(null) : setChanged(false))}
      />
    </div>
  );
}
