import { Button, ConfirmDialog, Dialog, ErrorMessage, FormSelect, Input } from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Globe, Loader2, Plus, Trash2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { AdminDialogShell, AdminEmptyState } from "@/components/common/AdminDialogShell";
import { operationError } from "@/lib/api";
import { useWebSearchSettings, webSearchSettingsKey } from "@/lib/queries";
import {
  type ApiWebSearchConnection,
  type ApiWebSearchProvider,
  type ApiWebSearchRegion,
  createWebSearchConnection,
  deleteWebSearchConnection,
  saveWebSearchSettings,
  testWebSearchConnection,
  updateWebSearchConnection,
} from "@/lib/workspaceApi";

const providerOptions = [
  { value: "deepseek", label: "DeepSeek Search & Fetch" },
  { value: "glm", label: "GLM Web Search / Reader" },
] as const;

const regionOptions = [
  { value: "cn", label: "国内（open.bigmodel.cn）" },
  { value: "global", label: "国际（api.z.ai）" },
] as const;

const maxResultOptions = ["3", "5", "8", "10"].map((value) => ({ value, label: `${value} 条` }));

function providerLabel(provider: ApiWebSearchProvider): string {
  return provider === "deepseek" ? "DeepSeek" : "GLM";
}

export function WebSearchSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useWebSearchSettings();
  const connections = settings.data.connections;
  const active = connections.find((item) => item.id === settings.data.activeConnectionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<ApiWebSearchProvider>("deepseek");
  const [region, setRegion] = useState<ApiWebSearchRegion>("cn");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiWebSearchConnection | null>(null);
  const [maxResults, setMaxResults] = useState("5");
  const [maxSearches, setMaxSearches] = useState("6");
  const [maxFetches, setMaxFetches] = useState("4");

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setEditing(false);
    setError(null);
    setNotice(null);
    setApiKey("");
    setProvider("deepseek");
    setRegion("cn");
    setLabel("");
  }, [open]);

  useEffect(() => {
    setMaxResults(String(settings.data.maxResults));
    setMaxSearches(String(settings.data.maxSearchesPerTurn));
    setMaxFetches(String(settings.data.maxFetchesPerTurn));
  }, [settings.data.maxResults, settings.data.maxSearchesPerTurn, settings.data.maxFetchesPerTurn]);

  const selected = connections.find((item) => item.id === selectedId) ?? null;

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: webSearchSettingsKey });
  };

  const select = (connection: ApiWebSearchConnection | null): void => {
    setSelectedId(connection?.id ?? null);
    setEditing(connection === null);
    setNotice(null);
    setError(null);
    setApiKey("");
    if (connection === null) {
      setProvider("deepseek");
      setRegion("cn");
      setLabel("");
      return;
    }
    setProvider(connection.provider);
    setRegion(connection.region ?? "cn");
    setLabel(connection.label);
  };

  const saveConnection = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (selected === null) {
        await createWebSearchConnection({
          provider,
          label: label.trim(),
          apiKey,
          ...(provider === "glm" ? { region } : {}),
        });
      } else {
        await updateWebSearchConnection(selected.id, {
          label: label.trim(),
          ...(provider === "glm" ? { region } : {}),
          ...(apiKey.trim().length > 0 ? { apiKey } : {}),
        });
      }
      await refresh();
      setSelectedId(null);
      setEditing(false);
      setApiKey("");
      setNotice("搜索连接已保存");
    } catch (cause) {
      setError(operationError(cause, "保存搜索连接失败"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (confirmDelete === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await deleteWebSearchConnection(confirmDelete.id);
      setConfirmDelete(null);
      setSelectedId(null);
      setEditing(false);
      await refresh();
    } catch (cause) {
      setError(operationError(cause, "删除搜索连接失败"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveWebSearchSettings({
        activeConnectionId: id,
        maxResults: Number(maxResults),
        maxSearchesPerTurn: Number(maxSearches),
        maxFetchesPerTurn: Number(maxFetches),
      });
      await refresh();
      setNotice("已切换当前搜索连接");
    } catch (cause) {
      setError(operationError(cause, "切换搜索连接失败"));
    } finally {
      setBusy(false);
    }
  };

  const test = async (connection: ApiWebSearchConnection): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await testWebSearchConnection(connection.id);
      setNotice(`连接可用：${result.resultCount} 条结果，${result.latencyMs} ms`);
    } catch (cause) {
      setError(operationError(cause, "搜索连接测试失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveWebSearchSettings({
        activeConnectionId: settings.data.activeConnectionId,
        maxResults: Number(maxResults),
        maxSearchesPerTurn: Number(maxSearches),
        maxFetchesPerTurn: Number(maxFetches),
      });
      await refresh();
      setNotice("配额已保存");
    } catch (cause) {
      setError(operationError(cause, "保存配额失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <AdminDialogShell
          icon={Globe}
          title="联网搜索"
          description="独立管理联网搜索的连接与 Key，与模型 Key 隔离"
          closeLabel="关闭联网搜索"
          count={connections.length}
          actions={
            active === undefined ? null : (
              <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-1 text-[9.5px] text-success">
                <Check size={10} /> {active.label}
              </span>
            )
          }
        >
          {error ? (
            <div className="shrink-0 px-5 pt-3">
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
            </div>
          ) : null}
          {notice ? (
            <div className="shrink-0 px-5 pt-3 text-[10.5px] text-success">{notice}</div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 w-[40%] min-w-0 flex-col border-r border-line">
              <div className="flex shrink-0 items-center justify-between border-b border-line px-3 py-2">
                <span className="text-[10.5px] font-semibold text-ink-3">搜索连接</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => select(null)}
                  aria-label="添加搜索连接"
                >
                  <Plus size={13} />
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {connections.length === 0 ? (
                  <AdminEmptyState
                    icon={Globe}
                    title="还没有搜索连接"
                    hint="添加 DeepSeek 或 GLM 的搜索 Key 后，才能在输入框点亮地球按钮。"
                    compact
                  />
                ) : (
                  <div className="space-y-1">
                    {connections.map((connection) => (
                      <button
                        key={connection.id}
                        type="button"
                        aria-label={`选择连接：${connection.label}`}
                        onClick={() => select(connection)}
                        className={`w-full rounded-lg border px-2.5 py-2 text-left ${
                          connection.id === selectedId
                            ? "border-accent/40 bg-accent-soft"
                            : "border-transparent hover:bg-surface-2"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[11.5px] font-medium text-ink">
                            {connection.label}
                          </span>
                          {connection.id === settings.data.activeConnectionId ? (
                            <span className="rounded-full bg-success/10 px-1.5 py-[1px] text-[8.5px] text-success">
                              当前
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-[9.5px] text-ink-3">
                          {providerLabel(connection.provider)}
                          {connection.region === null ? "" : ` · ${connection.region}`} ·{" "}
                          {connection.maskedKey}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 w-[60%] flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!editing ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-line bg-surface-2/50 p-3">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-ink">
                        <Zap size={13} className="text-accent" /> 每轮搜索配额
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <FormSelect
                          label="结果数"
                          showLabel
                          value={maxResults}
                          onValueChange={setMaxResults}
                          options={maxResultOptions}
                        />
                        <label
                          htmlFor="web-search-max-searches"
                          className="block text-[10px] text-ink-3"
                        >
                          搜索次数
                          <Input
                            id="web-search-max-searches"
                            className="mt-1"
                            inputMode="numeric"
                            value={maxSearches}
                            onChange={(event) => setMaxSearches(event.target.value)}
                          />
                        </label>
                        <label
                          htmlFor="web-search-max-fetches"
                          className="block text-[10px] text-ink-3"
                        >
                          抓取次数
                          <Input
                            id="web-search-max-fetches"
                            className="mt-1"
                            inputMode="numeric"
                            value={maxFetches}
                            onChange={(event) => setMaxFetches(event.target.value)}
                          />
                        </label>
                      </div>
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void saveLimits()}
                      >
                        保存配额
                      </Button>
                    </div>

                    {selected === null ? (
                      <p className="text-[10.5px] leading-relaxed text-ink-3">
                        选择一个连接后可以测试或设为当前连接。搜索 Key
                        只保存在本机加密存储，不会进入模型上下文。
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setEditing(true)}
                        >
                          编辑
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy || selected.id === settings.data.activeConnectionId}
                          onClick={() => void activate(selected.id)}
                        >
                          设为当前
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void test(selected)}
                        >
                          {busy ? <Loader2 size={12} className="animate-spin" /> : null}
                          测试连接
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => setConfirmDelete(selected)}
                        >
                          <Trash2 size={12} /> 删除
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <FormSelect
                      label="服务商"
                      showLabel
                      value={provider}
                      onValueChange={(value) => setProvider(value as ApiWebSearchProvider)}
                      options={[...providerOptions]}
                      disabled={selected !== null}
                    />
                    {provider === "glm" ? (
                      <FormSelect
                        label="区域"
                        showLabel
                        value={region}
                        onValueChange={(value) => setRegion(value as ApiWebSearchRegion)}
                        options={[...regionOptions]}
                      />
                    ) : null}
                    <label
                      htmlFor="web-search-connection-label"
                      className="block text-[10.5px] font-semibold text-ink-3"
                    >
                      名称
                      <Input
                        id="web-search-connection-label"
                        className="mt-1"
                        value={label}
                        onChange={(event) => setLabel(event.target.value)}
                        placeholder="例如：DeepSeek 搜索"
                      />
                    </label>
                    <label
                      htmlFor="web-search-connection-key"
                      className="block text-[10.5px] font-semibold text-ink-3"
                    >
                      API Key
                      <Input
                        id="web-search-connection-key"
                        className="mt-1 font-mono text-[11px]"
                        type="password"
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        placeholder={selected === null ? "sk-…" : "留空表示不修改"}
                        autoComplete="off"
                      />
                    </label>
                    <p className="text-[9.5px] leading-relaxed text-ink-3">
                      搜索 Key 与模型 Key 分开保存。DeepSeek 使用 Search & Fetch API；GLM 使用 Web
                      Search / Reader API。
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={busy || !label.trim() || (selected === null && !apiKey.trim())}
                        onClick={() => void saveConnection()}
                      >
                        保存连接
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          if (selected === null) select(null);
                          else setEditing(false);
                        }}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </AdminDialogShell>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除搜索连接？"
        description={`将删除「${confirmDelete?.label ?? ""}」及其加密 Key。已开启联网搜索的会话会在下一轮失败关闭，直到重新配置。`}
        confirmLabel="删除"
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
