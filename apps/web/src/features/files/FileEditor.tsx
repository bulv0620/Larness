import Editor from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import { useTheme } from "@/app/ThemeProvider";
import "@/lib/monaco";
export default function FileEditor({
  identity,
  path,
  text,
  original,
  readOnly,
  onChange,
}: {
  identity: string;
  path: string;
  text: string;
  original?: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const { resolved } = useTheme();
  const language = path.endsWith(".json")
    ? "json"
    : path.endsWith(".md")
      ? "markdown"
      : /\.[cm]?tsx?$/.test(path)
        ? "typescript"
        : /\.[cm]?jsx?$/.test(path)
          ? "javascript"
          : path.endsWith(".css")
            ? "css"
            : "plaintext";
  const options = {
    readOnly,
    editContext: false,
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 12,
    scrollBeyondLastLine: false,
    ariaLabel: "文件内容",
  };
  const theme = resolved === "dark" ? "vs-dark" : "light";
  // Monaco omits a leading BOM from its model value; keep it in the editable draft bytes.
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (original !== undefined)
    return <ReadOnlyDiff original={original} modified={text} language={language} theme={theme} />;
  return (
    <Editor
      height="100%"
      path={fileModelPath(identity)}
      keepCurrentModel
      language={language}
      value={text.slice(bom.length)}
      theme={theme}
      options={options}
      onChange={(value) => {
        if (value !== undefined && bom + value !== text) onChange(bom + value);
      }}
    />
  );
}

export function fileModelPath(identity: string) {
  return `larness-file:${encodeURIComponent(identity)}`;
}
export function disposeFileModel(identity: string) {
  monaco.editor.getModel(monaco.Uri.parse(fileModelPath(identity)))?.dispose();
}

function ReadOnlyDiff({
  original,
  modified,
  language,
  theme,
}: {
  original: string;
  modified: string;
  language: string;
  theme: string;
}) {
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const left = monaco.editor.createModel(original, language);
    const right = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(container.current, {
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12,
      renderSideBySide: true,
    });
    monaco.editor.setTheme(theme);
    editor.setModel({ original: left, modified: right });
    return () => {
      // Detach before releasing models; Monaco requires this order for diff widgets.
      editor.setModel(null);
      editor.dispose();
      left.dispose();
      right.dispose();
    };
  }, [original, modified, language, theme]);
  return <section ref={container} className="h-full w-full" aria-label="磁盘与草稿差异" />;
}
