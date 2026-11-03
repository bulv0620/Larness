import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useState } from "react";
import { saveDraft } from "@/features/files/actions";
import { fileError, fileKey, readFile, scopeId } from "@/features/files/api";
import { useFileDraftStore } from "@/features/files/drafts";
import { USE_MOCKS } from "@/lib/env";
import type { WindowTab } from "@/lib/windowTypes";
import { DemoFileWindow } from "./DemoFileWindow";

const FileEditor = lazy(() => import("@/features/files/FileEditor"));
export function FileWindow({ tab }: { tab: WindowTab }) {
  if (USE_MOCKS) return <DemoFileWindow tab={tab} />;
  if (!tab.file)
    return (
      <div className="p-5 text-sm text-ink-3">
        从右侧文件树打开文件。旧的预览 Tab 请关闭后重新打开。
      </div>
    );
  return <EditableFile key={tab.id} tab={tab} target={tab.file} />;
}
function EditableFile({ tab, target }: { tab: WindowTab; target: NonNullable<WindowTab["file"]> }) {
  const query = useQuery({
    queryKey: fileKey(target.scope, target.path),
    queryFn: () => readFile(target.scope, target.path),
    staleTime: 0,
  });
  const monitoring = useFileDraftStore((state) => state.monitoring[scopeId(target.scope)]);
  const draft = useFileDraftStore((state) => state.drafts[tab.resourceId]);
  const saving = useFileDraftStore((state) => state.saving[tab.resourceId] ?? false);
  const [error, setError] = useState<string | null>(null);
  const [diff, setDiff] = useState(false);
  const doc = query.data;
  const conflict = !!draft && !!doc && draft.baseVersion !== doc.version;
  const text = draft?.text ?? doc?.content;
  const edit = (value: string) => {
    if (!doc) return;
    if (value === doc.content && (!draft || draft.baseVersion === doc.version))
      useFileDraftStore.getState().discard(tab.resourceId);
    else
      useFileDraftStore.getState().edit(tab.resourceId, value, draft?.baseVersion ?? doc.version);
  };
  const save = () => {
    setError(null);
    void saveDraft(tab).catch((error: unknown) => setError(fileError(error)));
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (!saving && !query.isError && !conflict) {
          setError(null);
          void saveDraft(tab).catch((error: unknown) => setError(fileError(error)));
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [saving, query.isError, conflict, tab]);
  return (
    <div className="flex h-full flex-col text-[11px] text-ink-2">
      <div className="flex shrink-0 items-center gap-3 border-b border-line p-2">
        <span className="min-w-0 flex-1 truncate font-mono" title={target.path}>
          {target.path}
          {draft ? " ●" : ""}
        </span>
        <button
          type="button"
          aria-label="刷新文件"
          disabled={saving}
          onClick={() => {
            setError(null);
            void query.refetch();
          }}
        >
          刷新
        </button>
        <button
          type="button"
          aria-label="保存文件"
          disabled={!draft || saving || conflict || query.isError}
          onClick={save}
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
      {(error && !conflict) || query.isError ? (
        <div role="alert" className="shrink-0 p-2 text-danger">
          {error ?? fileError(query.error)}
        </div>
      ) : null}
      {conflict ? (
        <div className="shrink-0 space-y-2 border-b border-line bg-warning/10 p-2">
          <p role="status">磁盘文件已变化，草稿已保留。</p>
          <div className="flex gap-4">
            <button type="button" onClick={() => setDiff(!diff)}>
              {diff ? "返回编辑" : "查看差异"}
            </button>
            <button
              type="button"
              onClick={() => {
                useFileDraftStore.getState().discard(tab.resourceId);
                setDiff(false);
                setError(null);
              }}
            >
              重新加载磁盘
            </button>
            <button
              type="button"
              onClick={() => {
                if (doc && draft)
                  useFileDraftStore.getState().edit(tab.resourceId, draft.text, doc.version);
                setDiff(false);
                setError(null);
              }}
            >
              手工合并
            </button>
          </div>
          <p className="text-ink-3">
            {diff
              ? "磁盘版本 → 本地草稿"
              : "重载将放弃草稿；手工合并保留草稿，编辑后按当前磁盘版本保存。"}
          </p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {text !== undefined ? (
          <Suspense fallback={<p className="p-4">正在加载编辑器…</p>}>
            <FileEditor
              key={`${tab.resourceId}:${diff}`}
              identity={tab.resourceId}
              path={target.path}
              text={text}
              original={diff && conflict ? doc?.content : undefined}
              readOnly={saving || query.isError}
              onChange={edit}
            />
          </Suspense>
        ) : (
          <p className="p-4">{query.isPending ? "正在读取完整文件…" : "文件不可用"}</p>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3 py-1 text-ink-3">
        UTF-8 · {draft ? "未保存" : "已同步"}
        {query.isFetching ? " · 正在刷新" : ""} · {monitoring ?? "正在连接文件监听…"}
      </div>
    </div>
  );
}
