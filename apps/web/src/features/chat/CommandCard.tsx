import { CommandDtoSchema, CommandOutputPageSchema, type CommandStatus } from "@larness/shared";
import { Button, ErrorMessage } from "@larness/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useCommandWatch } from "./useCommandWatch";

const LABELS: Record<CommandStatus, string> = {
  CREATED: "准备执行",
  RUNNING: "执行中",
  CANCELLING: "正在停止",
  COMPLETED: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
  TIMED_OUT: "执行超时",
  INTERRUPTED: "执行中断",
};
const isActive = (status?: string) =>
  !status || ["CREATED", "RUNNING", "CANCELLING"].includes(status);
interface OutputSnapshot {
  text: string;
  truncated: boolean;
  gap: boolean;
  cursor: number;
}
async function loadOutput(id: string, previous?: OutputSnapshot): Promise<OutputSnapshot> {
  let cursor = previous?.cursor ?? 0;
  let text = previous?.text ?? "";
  let truncated = previous?.truncated ?? false;
  let gap = previous?.gap ?? false;
  // The file is capped at 2 MiB including framing; 64 pages bound this snapshot read.
  for (let page = 0; page < 64; page++) {
    const result = CommandOutputPageSchema.parse(
      await apiFetch(`/api/commands/${id}/output?after=${cursor}&limit=500`),
    );
    if (result.resyncRequired && !result.chunks.length) text = "";
    text += result.chunks
      .filter((chunk) => chunk.cursor > cursor)
      .map((chunk) => chunk.data)
      .join("");
    truncated ||= result.truncated;
    gap ||= result.resyncRequired;
    if (result.nextCursor <= cursor || result.chunks.length < 500)
      return { text, truncated, gap, cursor: result.nextCursor };
    cursor = result.nextCursor;
  }
  return { text, truncated: true, gap, cursor };
}
export function CommandCard({ commandId }: { commandId: string }) {
  const client = useQueryClient();
  const state = useQuery({
    queryKey: ["command", commandId, "state"],
    queryFn: async () => CommandDtoSchema.parse(await apiFetch(`/api/commands/${commandId}`)),
    staleTime: 0,
    refetchInterval: (query) =>
      isActive(query.state.data?.status) && !query.state.error ? 2000 : false,
  });
  const active = isActive(state.data?.status);
  useCommandWatch(commandId, active && !state.error);
  const output = useQuery({
    queryKey: ["command", commandId, "output"],
    queryFn: () =>
      loadOutput(commandId, client.getQueryData<OutputSnapshot>(["command", commandId, "output"])),
    staleTime: 0,
    refetchInterval: active && !state.error ? 2000 : false,
  });
  const status = state.data?.status;
  useEffect(() => {
    // A terminal snapshot can beat the coalesced WS notification; fetch the final tail.
    if (status && !isActive(status))
      void client.invalidateQueries({ queryKey: ["command", commandId, "output"] });
  }, [client, commandId, status]);
  const refresh = () => client.invalidateQueries({ queryKey: ["command", commandId] });
  const cancel = useMutation({
    mutationFn: async () =>
      CommandDtoSchema.parse(
        await apiFetch(`/api/commands/${commandId}/cancel`, {
          method: "POST",
          body: {},
          csrf: true,
        }),
      ),
    onSuccess: (data) => {
      client.setQueryData(["command", commandId, "state"], data);
      void refresh();
    },
    onError: () => {
      void refresh();
    },
  });
  return (
    <section
      aria-label="命令执行"
      className="mt-2 overflow-hidden rounded-xl border border-line bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
        <span className="font-semibold text-ink">命令执行</span>
        <span role="status" className="text-ink-2">
          {state.data ? LABELS[state.data.status] : state.error ? "命令不可用" : "正在读取状态…"}
        </span>
        {state.data?.exitCode !== null && state.data?.exitCode !== undefined ? (
          <span className="font-mono text-ink-3">退出码 {state.data.exitCode}</span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" variant="secondary" onClick={() => void refresh()}>
            刷新输出
          </Button>
          {state.data && active ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={cancel.isPending || state.data.status === "CANCELLING"}
              onClick={() => cancel.mutate()}
            >
              取消命令
            </Button>
          ) : null}
        </div>
      </div>
      {state.data?.reasonCode ? (
        <p className="px-3 text-[11px] text-ink-2">原因：{state.data.reasonCode}</p>
      ) : null}
      {state.data?.status === "INTERRUPTED" ? (
        <p className="px-3 text-[11px] text-warning">
          执行已中断；停止情况以状态原因为准，不能确认时项目保持受阻。
        </p>
      ) : null}
      <ErrorMessage
        message={
          cancel.error
            ? "取消命令失败，请刷新确认。"
            : state.error || output.error
              ? "命令状态或输出读取失败。"
              : null
        }
        onDismiss={cancel.error ? () => cancel.reset() : undefined}
      />
      {output.data?.gap ? (
        <p className="px-3 text-[11px] text-warning">输出有缺口，以下仅为当前可用记录。</p>
      ) : null}
      {output.data?.truncated || state.data?.truncated ? (
        <p className="px-3 text-[11px] text-warning">输出已截断。</p>
      ) : null}
      <pre
        role="log"
        aria-label="命令输出"
        className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words border-t border-line bg-surface-2 px-3 py-2 font-mono text-[11px] text-ink-2"
      >
        {output.data?.text || (active ? "等待命令输出…" : "无可用输出")}
      </pre>
    </section>
  );
}
