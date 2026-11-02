import type { IpcClient } from "../ipc/client.js";
import { IpcClientError } from "../ipc/client.js";
import { runDevicesView } from "./devices.js";
import { runPairingView } from "./pairing.js";
import { AuditSchema, LogLinesSchema, type ScreenStatus, StatusSchema } from "./schemas.js";
import { NavigationCancelled, type TerminalSession } from "./terminal.js";

export function displayError(error: unknown): string {
  if (error instanceof IpcClientError) return `${error.code}：操作未完成，请刷新查看实际状态`;
  return "无法读取或校验数据，请刷新重试";
}

export async function runScreenDashboard(deps: {
  terminal: TerminalSession;
  client: Pick<IpcClient, "request">;
  webUrl?: string;
  localLogs?: () => string[];
}): Promise<void> {
  const { terminal, client } = deps;
  const menu = ["配对", "设备", "日志", "审计", "退出并停止服务"];
  let selected = 0;
  let page: "overview" | "exit" | "legacy" = "overview";
  let status: ScreenStatus | null = null;
  let error = "";
  let generation = 0;
  let loading = false;
  let confirmExit = false;
  const render = () => {
    if (page === "legacy") return;
    if (page === "exit") {
      terminal.render({
        title: "退出确认",
        body: [
          "退出将停止 Server 与 Web。",
          "",
          `${confirmExit ? "  " : "› "}取消`,
          `${confirmExit ? "› " : "  "}确认退出并停止服务`,
        ],
        footer: "↑↓ 选择 · Enter 确认 · Esc 取消 · Ctrl+C 停止服务",
      });
      return;
    }
    terminal.render({
      title: "控制面板",
      body: [
        status
          ? `状态：${status.running ? "运行中" : "已停止"} · ${status.version}`
          : "正在读取运行状态…",
        `Web：${deps.webUrl ?? (status ? `http://localhost:${status.listen.port}` : "读取中")}`,
        status
          ? `待配对 ${status.sessions.pendingPairings} · 在线会话 ${status.sessions.online}`
          : "",
        ...(status?.warnings.map((warning) => `! ${warning}`) ?? []),
        "",
        ...menu.map((label, i) => `${selected === i ? "›" : " "} ${label}`),
        "",
        loading ? "正在刷新…" : error,
      ],
      footer: "↑↓ 选择 · Enter 打开 · p/d/l/a · r 刷新 · q 退出",
    });
  };
  const refresh = () => {
    if (loading) return;
    loading = true;
    const request = ++generation;
    render();
    void client
      .request("system.status")
      .then((value) => {
        if (request !== generation) return;
        status = StatusSchema.parse(value);
        error = "";
      })
      .catch((cause: unknown) => {
        if (request === generation) error = displayError(cause);
      })
      .finally(() => {
        if (request === generation) {
          loading = false;
          render();
        }
      });
  };
  refresh();
  try {
    for (;;) {
      const key = await terminal.nextKey();
      if (page === "exit") {
        if (key.name === "escape") {
          page = "overview";
          render();
        } else if (key.name === "up" || key.name === "down") {
          confirmExit = !confirmExit;
          render();
        } else if (key.name === "return") {
          if (confirmExit) return;
          page = "overview";
          render();
        }
        continue;
      }
      if (key.name === "up" || key.name === "down") {
        selected = (selected + (key.name === "up" ? menu.length - 1 : 1)) % menu.length;
        render();
        continue;
      }
      if (key.name === "r") {
        refresh();
        continue;
      }
      const shortcut = ["p", "d", "l", "a", "q"].indexOf(key.name);
      if (shortcut < 0 && key.name !== "return") continue;
      if (shortcut >= 0) selected = shortcut;
      if (selected === 4) {
        page = "exit";
        confirmExit = false;
        render();
        continue;
      }
      ++generation;
      loading = false;
      page = "legacy";
      terminal.blockInput(true);
      const lines: string[] = [];
      const title = menu[selected] ?? "功能";
      const out = (text: string) => {
        lines.push(text);
        terminal.render({ title, body: lines, footer: "Esc 返回 · Ctrl+C 停止服务" });
      };
      const ask = async (message: string) => terminal.ask(message);
      terminal.render({ title, body: ["正在读取…"], footer: "Ctrl+C 停止服务" });
      try {
        if (selected === 0) await runPairingView({ client, out, ask });
        else if (selected === 1) await runDevicesView({ client, out, ask });
        else {
          if (selected === 2) {
            const logs = LogLinesSchema.parse(await client.request("logs.tail", { lines: 20 }));
            out(
              [
                "Server 最近日志",
                ...logs.lines,
                "",
                "子进程输出",
                ...(deps.localLogs?.() ?? []),
              ].join("\n"),
            );
          } else {
            const audit = AuditSchema.parse(await client.request("audit.tail", { limit: 20 }));
            out(
              audit.items
                .map(
                  (item) =>
                    `${new Date(item.createdAt).toLocaleString()} ${item.action} ${item.decision ?? ""}`,
                )
                .join("\n") || "最近审计：无",
            );
          }
          await ask("按回车返回控制面板");
        }
      } catch (cause) {
        if (!(cause instanceof NavigationCancelled)) {
          out(displayError(cause));
          await ask("按回车返回控制面板");
        }
      }
      terminal.blockInput(false);
      page = "overview";
      render();
      refresh();
    }
  } finally {
    ++generation;
  }
}
