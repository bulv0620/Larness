import type { IpcClient } from "../ipc/client.js";
import { disconnected, displayError } from "./page-error.js";
import { AuditSchema, LogLinesSchema } from "./schemas.js";
import { bodyLines } from "./screen.js";
import type { TerminalSession } from "./terminal.js";

interface Snapshot {
  lines: string[] | null;
  count: number;
  offset: number;
  time: string;
  error: string;
}

export async function runReadingPage(
  kind: "logs" | "audit",
  deps: {
    terminal: TerminalSession;
    client: Pick<IpcClient, "request">;
    localLogs?: () => string[];
  },
): Promise<void> {
  const { terminal, client } = deps;
  const snapshots: Snapshot[] = Array.from({ length: kind === "logs" ? 2 : 1 }, () => ({
    lines: null,
    count: 0,
    offset: 0,
    time: "",
    error: "",
  }));
  let source = 0;
  let generation = 0;
  let loading = false;
  let fatal: unknown;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const maxOffset = (snapshot: Snapshot) =>
    Math.max(0, bodyLines(snapshot.lines ?? [], terminal.columns).length - terminal.bodyHeight);
  const render = () => {
    const snapshot = snapshots[source];
    if (!snapshot) return;
    snapshot.offset = Math.min(snapshot.offset, maxOffset(snapshot));
    const label = kind === "audit" ? "审计" : `日志 · ${source === 0 ? "Server" : "子进程"}`;
    const state = snapshot.error
      ? snapshot.lines === null
        ? "读取失败"
        : "刷新失败，当前为上次快照"
      : loading
        ? "刷新中"
        : "";
    terminal.render({
      title: `${label} · ${snapshot.count}${kind === "audit" ? "条" : "行"} · ${snapshot.time || "尚无快照"}${loading ? " · 刷新中" : ""}`,
      body:
        snapshot.lines === null
          ? [snapshot.error || "正在读取…"]
          : snapshot.lines.length
            ? snapshot.lines
            : [kind === "audit" ? "暂无审计记录" : "暂无日志"],
      offset: snapshot.offset,
      footer: snapshot.error
        ? `${state} · ${snapshot.error.includes("：") ? snapshot.error.split("：")[0] : "数据错误"} · r刷新 Esc返回`
        : `${kind === "logs" ? "←→来源 " : ""}↑↓/PgUp/Dn Home/End · r刷新 Esc返回 ^C停止`,
    });
  };
  const store = (index: number, lines: string[], count: number) => {
    const snapshot = snapshots[index];
    if (!snapshot) return;
    const atBottom = snapshot.lines === null || snapshot.offset >= maxOffset(snapshot);
    snapshot.lines = lines;
    snapshot.count = count;
    snapshot.error = "";
    snapshot.time = `${new Date().toLocaleTimeString("en-GB", { hour12: false })} ${zone}`;
    snapshot.offset =
      kind === "logs" && atBottom
        ? maxOffset(snapshot)
        : Math.min(snapshot.offset, maxOffset(snapshot));
  };
  const fail = (index: number, error: unknown) => {
    const snapshot = snapshots[index];
    if (snapshot) snapshot.error = displayError(error);
    if (disconnected(error)) fatal = error;
  };
  const refresh = () => {
    if (loading) return;
    loading = true;
    const request = ++generation;
    if (kind === "logs") {
      try {
        if (deps.localLogs) {
          const local = LogLinesSchema.parse({ lines: deps.localLogs().slice(-300) });
          store(1, local.lines, local.lines.length);
        } else {
          const local = snapshots[1];
          if (local) local.error = "子进程输出来源不可用";
        }
      } catch (error) {
        fail(1, error);
      }
    }
    render();
    void client
      .request(
        kind === "logs" ? "logs.tail" : "audit.tail",
        kind === "logs" ? { lines: 200 } : { limit: 200 },
      )
      .then((value) => {
        if (request !== generation) return;
        if (kind === "logs") {
          const data = LogLinesSchema.parse(value).lines.slice(-200);
          store(0, data, data.length);
        } else {
          const data = AuditSchema.parse(value).items.sort((a, b) => b.createdAt - a.createdAt);
          store(
            0,
            data.map(
              (item) =>
                `${new Date(item.createdAt).toLocaleString()} ${item.action} ${item.decision ?? ""} ${item.resourceType ?? ""} ${item.resourceId ?? ""}`,
            ),
            data.length,
          );
        }
      })
      .catch((error: unknown) => {
        if (request === generation) fail(0, error);
      })
      .finally(() => {
        if (request !== generation) return;
        loading = false;
        render();
        terminal.notify();
      });
  };
  refresh();
  try {
    for (;;) {
      const key = await terminal.nextKey();
      if (fatal !== undefined) throw fatal;
      if (key.name === "escape") return;
      if (terminal.small || key.name === "update") continue;
      if (key.name === "r") {
        refresh();
        continue;
      }
      if (kind === "logs" && (key.name === "left" || key.name === "right")) {
        source = source === 0 ? 1 : 0;
      } else {
        const snapshot = snapshots[source];
        if (!snapshot) continue;
        const max = maxOffset(snapshot);
        const offset = Math.min(snapshot.offset, max);
        const step = Math.max(1, terminal.bodyHeight - 1);
        if (key.name === "home") snapshot.offset = 0;
        else if (key.name === "end") snapshot.offset = max;
        else if (key.name === "up") snapshot.offset = Math.max(0, offset - 1);
        else if (key.name === "down") snapshot.offset = Math.min(max, offset + 1);
        else if (key.name === "pageup") snapshot.offset = Math.max(0, offset - step);
        else if (key.name === "pagedown") snapshot.offset = Math.min(max, offset + step);
        else continue;
      }
      render();
    }
  } finally {
    ++generation;
    for (const snapshot of snapshots) snapshot.lines = null;
  }
}
