import { disconnected, displayError } from "./page-error.js";

export { displayError } from "./page-error.js";

import type { IpcClient } from "../ipc/client.js";
import { runReadingPage } from "./reading-page.js";
import { runResourcePage } from "./resource-pages.js";
import { type ScreenStatus, StatusSchema } from "./schemas.js";
import { NavigationCancelled, TerminalInterrupted, type TerminalSession } from "./terminal.js";

export async function runScreenDashboard(deps: {
  terminal: TerminalSession;
  client: Pick<IpcClient, "request">;
  webUrl?: string;
  localLogs?: () => string[];
}): Promise<void> {
  const { terminal, client } = deps;
  const menu = ["配对", "设备", "日志", "审计", "退出并停止服务"];
  let selected = 0;
  let page: "overview" | "exit" | "child" = "overview";
  let status: ScreenStatus | null = null;
  let error = "";
  let connectionError: unknown;
  let generation = 0;
  let loading = false;
  let confirmExit = false;
  const render = () => {
    if (page === "child") return;
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
        if (request === generation) {
          error = displayError(cause);
          if (disconnected(cause)) connectionError = cause;
        }
      })
      .finally(() => {
        if (request === generation) {
          loading = false;
          render();
          terminal.notify();
        }
      });
  };
  refresh();
  try {
    for (;;) {
      const key = await terminal.nextKey();
      if (connectionError !== undefined) throw connectionError;
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
      page = "child";

      const lines: string[] = [];
      const title = menu[selected] ?? "功能";
      const out = (text: string) => {
        lines.push(text);
        terminal.render({ title, body: lines, footer: "Esc 返回 · Ctrl+C 停止服务" });
      };
      const ask = async (message: string) => terminal.ask(message);
      terminal.render({ title, body: ["正在读取…"], footer: "Ctrl+C 停止服务" });
      try {
        if (selected === 0 || selected === 1)
          await runResourcePage(selected === 0 ? "pairing" : "devices", { client, terminal });
        else await runReadingPage(selected === 2 ? "logs" : "audit", deps);
      } catch (cause) {
        if (disconnected(cause) || cause instanceof TerminalInterrupted) throw cause;
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
