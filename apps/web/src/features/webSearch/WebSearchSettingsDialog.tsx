import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  ErrorMessage,
  FormSelect,
  IconButton,
  Input,
} from "@larness/ui";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Globe,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Zap,
} from "lucide-react";
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
  { value: "cn", label: "国内 · open.bigmodel.cn" },
  { value: "global", label: "国际 · api.z.ai" },
] as const;

const maxResultOptions = ["3", "5", "8", "10"].map((value) => ({ value, label: `${value} 条` }));

const subdialogClass =
  "z-[311] max-h-[calc(100dvh-32px)] w-[min(400px,calc(100vw-28px))] space-y-3 overflow-y-auto";

function providerLabel(provider: ApiWebSearchProvider): string {
  return provider === "deepseek" ? "DeepSeek" : "GLM";
}

function regionLabel(connection: ApiWebSearchConnection): string {
  if (connection.provider === "deepseek") return "固定端点";
  return connection.region === "global" ? "国际" : "国内";
}

type Subdialog = "add" | "edit" | "quota" | null;

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
  const activeId = settings.data.activeConnectionId;
  const [subdialog, setSubdialog] = useState<Subdialog>(null);
  const [editing, setEditing] = useState<ApiWebSearchConnection | null>(null);
  const [provider, setProvider] = useState<ApiWebSearchProvider>("deepseek");
  const [region, setRegion] = useState<ApiWebSearchRegion>("cn");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [maxResults, setMaxResults] = useState("5");
  const [maxSearches, setMaxSearches] = useState("6");
  const [maxFetches, setMaxFetches] = useState("4");
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiWebSearchConnection | null>(null);

  useEffect(() => {
    if (!open) return;
    setSubdialog(null);
    setEditing(null);
    setError(null);
    setNotice(null);
    setTestingId(null);
  }, [open]);

  useEffect(() => {
    setMaxResults(String(settings.data.maxResults));
    setMaxSearches(String(settings.data.maxSearchesPerTurn));
    setMaxFetches(String(settings.data.maxFetchesPerTurn));
  }, [settings.data.maxResults, settings.data.maxSearchesPerTurn, settings.data.maxFetchesPerTurn]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: webSearchSettingsKey });
  };

  const openAdd = (): void => {
    setEditing(null);
    setProvider("deepseek");
    setRegion("cn");
    setLabel("");
    setApiKey("");
    setError(null);
    setNotice(null);
    setSubdialog("add");
  };

  const openEdit = (connection: ApiWebSearchConnection): void => {
    setEditing(connection);
    setProvider(connection.provider);
    setRegion(connection.region ?? "cn");
    setLabel(connection.label);
    setApiKey("");
    setError(null);
    setNotice(null);
    setSubdialog("edit");
  };

  const openQuota = (): void => {
    setMaxResults(String(settings.data.maxResults));
    setMaxSearches(String(settings.data.maxSearchesPerTurn));
    setMaxFetches(String(settings.data.maxFetchesPerTurn));
    setError(null);
    setNotice(null);
    setSubdialog("quota");
  };

  const closeSubdialog = (): void => {
    if (busy) return;
    setSubdialog(null);
    setEditing(null);
    setError(null);
  };

  const saveConnection = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (editing === null) {
        await createWebSearchConnection({
          provider,
          label: label.trim(),
          apiKey,
          ...(provider === "glm" ? { region } : {}),
        });
        setNotice("搜索 Key 已添加");
      } else {
        await updateWebSearchConnection(editing.id, {
          label: label.trim(),
          ...(provider === "glm" ? { region } : {}),
          ...(apiKey.trim().length > 0 ? { apiKey } : {}),
        });
        setNotice("搜索 Key 已更新");
      }
      await refresh();
      setSubdialog(null);
      setEditing(null);
      setApiKey("");
    } catch (cause) {
      setError(operationError(cause, "保存搜索 Key 失败"));
    } finally {
      setBusy(false);
    }
  };

  const saveQuota = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await saveWebSearchSettings({
        activeConnectionId: activeId,
        maxResults: Number(maxResults),
        maxSearchesPerTurn: Number(maxSearches),
        maxFetchesPerTurn: Number(maxFetches),
      });
      await refresh();
      setSubdialog(null);
      setNotice("每轮配额已保存");
    } catch (cause) {
      setError(operationError(cause, "保存每轮配额失败"));
    } finally {
      setBusy(false);
    }
  };

  const activate = async (connection: ApiWebSearchConnection): Promise<void> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await saveWebSearchSettings({
        activeConnectionId: connection.id,
        maxResults: Number(maxResults),
        maxSearchesPerTurn: Number(maxSearches),
        maxFetchesPerTurn: Number(maxFetches),
      });
      await refresh();
      setNotice(`当前搜索 Key：${connection.label}`);
    } catch (cause) {
      setError(operationError(cause, "切换搜索 Key 失败"));
    } finally {
      setBusy(false);
    }
  };

  const test = async (connection: ApiWebSearchConnection): Promise<void> => {
    setBusy(true);
    setTestingId(connection.id);
    setError(null);
    setNotice(null);
    try {
      const result = await testWebSearchConnection(connection.id);
      setNotice(
        `「${connection.label}」连接可用：${result.resultCount} 条结果 · ${result.latencyMs} ms`,
      );
    } catch (cause) {
      setError(operationError(cause, "搜索 Key 测试失败"));
    } finally {
      setTestingId(null);
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (confirmDelete === null) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWebSearchConnection(confirmDelete.id);
      setConfirmDelete(null);
      await refresh();
      setNotice("搜索 Key 已删除");
    } catch (cause) {
      setError(operationError(cause, "删除搜索 Key 失败"));
      setConfirmDelete(null);
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
          description="独立管理搜索 Key 与每轮配额"
          closeLabel="关闭联网搜索"
          count={connections.length}
          onEscapeKeyDown={(event) => {
            if (subdialog !== null) {
              event.preventDefault();
              closeSubdialog();
            }
          }}
          actions={
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={openQuota}
                aria-label="每轮配额"
              >
                <Settings2 size={13} aria-hidden="true" />
                每轮配额
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={openAdd}
                aria-label="添加 Key"
              >
                <Plus size={13} aria-hidden="true" />
                添加 Key
              </Button>
            </>
          }
        >
          {error !== null && subdialog === null ? (
            <div className="shrink-0 px-5 pt-3">
              <ErrorMessage message={error} onDismiss={() => setError(null)} />
            </div>
          ) : null}
          {notice !== null ? (
            <div className="shrink-0 px-5 pt-3 text-[10.5px] text-success">{notice}</div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {connections.length === 0 ? (
              <AdminEmptyState
                icon={KeyRound}
                title="还没有搜索 Key"
                hint="添加 DeepSeek 或 GLM 的搜索 Key 后，输入框的地球按钮才可点亮。"
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={openAdd}
                    disabled={busy}
                    aria-label="添加第一个 Key"
                  >
                    <Plus size={13} aria-hidden="true" />
                    添加 Key
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line/70">
                {connections.map((connection) => {
                  const isActive = connection.id === activeId;
                  const isTesting = testingId === connection.id;
                  return (
                    <li key={connection.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-3">
                        <Globe size={14} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-ink">
                            {connection.label}
                          </span>
                          {isActive ? (
                            <span className="shrink-0 rounded-full bg-success/10 px-1.5 py-[1px] text-[8.5px] text-success">
                              当前
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate text-[9.5px] text-ink-3">
                          {providerLabel(connection.provider)} · {regionLabel(connection)} ·{" "}
                          <span className="font-mono">{connection.maskedKey}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <IconButton
                          label={`编辑 ${connection.label}`}
                          disabled={busy}
                          onClick={() => openEdit(connection)}
                        >
                          <Pencil size={13} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`设为当前 ${connection.label}`}
                          active={isActive}
                          disabled={busy || isActive}
                          onClick={() => void activate(connection)}
                        >
                          <Check size={13} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`测试连接 ${connection.label}`}
                          aria-busy={isTesting}
                          disabled={busy}
                          onClick={() => void test(connection)}
                        >
                          {isTesting ? (
                            <Loader2
                              size={13}
                              className="animate-spin motion-reduce:animate-none"
                              aria-hidden="true"
                            />
                          ) : (
                            <Zap size={13} aria-hidden="true" />
                          )}
                        </IconButton>
                        <IconButton
                          label={`删除 ${connection.label}`}
                          tone="danger"
                          disabled={busy}
                          onClick={() => setConfirmDelete(connection)}
                        >
                          <Trash2 size={13} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </AdminDialogShell>
      </Dialog>

      <Dialog
        open={subdialog === "add" || subdialog === "edit"}
        onOpenChange={(next) => {
          if (!next) closeSubdialog();
        }}
      >
        <DialogContent overlayClassName="z-[310]" className={subdialogClass}>
          <DialogTitle>{editing === null ? "添加搜索 Key" : "编辑搜索 Key"}</DialogTitle>
          <DialogDescription className="sr-only">
            搜索 Key 与模型 Key 分开保存，只保存在本机加密存储。
          </DialogDescription>
          {error !== null ? (
            <ErrorMessage message={error} onDismiss={() => setError(null)} />
          ) : null}
          <FormSelect
            label="服务商"
            showLabel
            value={provider}
            onValueChange={(value) => setProvider(value as ApiWebSearchProvider)}
            options={[...providerOptions]}
            disabled={editing !== null}
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
            htmlFor="web-search-key-label"
            className="block text-[10.5px] font-semibold text-ink-3"
          >
            名称
            <Input
              id="web-search-key-label"
              className="mt-1"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如：DeepSeek 搜索"
            />
          </label>
          <label
            htmlFor="web-search-key-secret"
            className="block text-[10.5px] font-semibold text-ink-3"
          >
            API Key
            <Input
              id="web-search-key-secret"
              className="mt-1 font-mono text-[11px]"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={editing === null ? "sk-…" : "留空表示不修改"}
              autoComplete="off"
            />
          </label>
          <p className="text-[9.5px] leading-relaxed text-ink-3">
            搜索 Key 与模型 Key 完全隔离。DeepSeek 使用 Search & Fetch API；GLM 使用 Web Search /
            Reader API。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={closeSubdialog}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={busy || !label.trim() || (editing === null && !apiKey.trim())}
              onClick={() => void saveConnection()}
            >
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={subdialog === "quota"}
        onOpenChange={(next) => {
          if (!next) closeSubdialog();
        }}
      >
        <DialogContent overlayClassName="z-[310]" className={subdialogClass}>
          <DialogTitle>每轮配额</DialogTitle>
          <DialogDescription className="sr-only">
            控制每轮搜索的结果数、搜索次数与抓取次数。
          </DialogDescription>
          {error !== null ? (
            <ErrorMessage message={error} onDismiss={() => setError(null)} />
          ) : null}
          <FormSelect
            label="结果数"
            showLabel
            value={maxResults}
            onValueChange={setMaxResults}
            options={maxResultOptions}
          />
          <label
            htmlFor="web-search-quota-searches"
            className="block text-[10.5px] font-semibold text-ink-3"
          >
            每轮搜索次数
            <Input
              id="web-search-quota-searches"
              className="mt-1"
              inputMode="numeric"
              value={maxSearches}
              onChange={(event) => setMaxSearches(event.target.value)}
            />
          </label>
          <label
            htmlFor="web-search-quota-fetches"
            className="block text-[10.5px] font-semibold text-ink-3"
          >
            每轮抓取次数
            <Input
              id="web-search-quota-fetches"
              className="mt-1"
              inputMode="numeric"
              value={maxFetches}
              onChange={(event) => setMaxFetches(event.target.value)}
            />
          </label>
          <p className="text-[9.5px] leading-relaxed text-ink-3">
            每轮配额对当前会话的每次 Turn 生效；0 表示禁止该类调用。
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" disabled={busy} onClick={closeSubdialog}>
              取消
            </Button>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => void saveQuota()}>
              保存
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除搜索 Key？"
        description={`将删除「${confirmDelete?.label ?? ""}」及其加密 Key。已开启联网搜索的会话会在下一轮失败关闭，直到重新配置。`}
        confirmLabel="删除"
        danger
        pending={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
