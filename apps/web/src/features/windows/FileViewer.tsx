import type { FileDocument } from "@larness/shared";
import Editor from "@monaco-editor/react";
import { useTheme } from "@/app/ThemeProvider";
import "@/lib/monaco";

export default function FileViewer({ doc }: { doc: FileDocument }) {
  const { resolved } = useTheme();

  return (
    <Editor
      height="100%"
      path={doc.path}
      defaultLanguage={doc.language}
      value={doc.content}
      theme={resolved === "dark" ? "vs-dark" : "light"}
      options={{
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12,
        lineHeight: 19,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        padding: { top: 12, bottom: 12 },
        scrollBeyondLastLine: false,
        renderLineHighlight: "none",
        wordWrap: "off",
        smoothScrolling: true,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
      }}
    />
  );
}
