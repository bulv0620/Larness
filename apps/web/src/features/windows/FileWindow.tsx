import type { FileDocument } from "@harness/shared";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";
import type { WindowTab } from "@/lib/windowTypes";
import { fileContents } from "@/mocks/fixtures";

const FileViewer = lazy(() => import("./FileViewer"));

function fallbackDocument(path: string): FileDocument {
  return {
    path,
    language: path.endsWith(".json") ? "json" : path.endsWith(".md") ? "markdown" : "typescript",
    content: `// ${path}\n// Mock 文件内容：S0 视觉 Demo 使用静态数据。\n\nexport const ready = true;\n`,
  };
}

export function FileWindow({ tab }: { tab: WindowTab }) {
  const doc = fileContents[tab.resourceId] ?? fallbackDocument(tab.resourceId);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-surface-2/30 px-3 font-mono text-[9.5px] text-ink-3">
        <span className="truncate">{doc.path}</span>
        <span className="ml-auto">{doc.language}</span>
        <span>·</span>
        <span>只读预览</span>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center gap-2 text-[11px] text-ink-3">
              <Loader2 size={14} className="animate-spin" />
              正在加载编辑器…
            </div>
          }
        >
          <FileViewer doc={doc} />
        </Suspense>
      </div>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-2/40 px-3 font-mono text-[9px] text-ink-3">
        <span>Ln 1, Col 1</span>
        <span className="ml-auto">UTF-8</span>
        <span>TypeScript</span>
      </div>
    </div>
  );
}
