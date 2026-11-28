import { disconnected, displayError, ServiceStopped } from "./page-error.js";

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
  updateCheck?: () => Promise<string | null>;
  attached?: boolean;
}): Promise<void> {
  const { terminal, client } = deps;
  const attached = deps.attached === true;
  const menu = attached
    ? ["配对", "设备", "日志", "审计", "停止服务", "退出面板"]
    : ["配对", "设备", "日志", "审计", "退出并停止服务"];
  const exitIndex = menu.length - 1;
  let selected = 0;
  let page: "overview" | "exit" | "stop" | "child" = "overview";
  let status: ScreenStatus | null = null;
  let error = "";
  let updateNotice = "";
  let connectionError: unknown;
  let generation = 0;
  let loading = false;
  let confirmExit = false;
  let confirmStop = false;
  const render = () => {
    if (page === "child") return;
    if (page === "exit") {
      terminal.render({
        title: "退出确认",
        body: attached
          ? [
              "退出面板不会停止服务，在途任务会继续运行。",
              "",
              `${confirmExit ? "  " : "› "}取消`,
              `${confirmExit ? "› " : "  "}退出面板`,
            ]
          : [
              "退出将停止 Server 与 Web。",
              "",
              `${confirmExit ? "  " : "› "}取消`,
              `${confirmExit ? "› " : "  "}确认退出并停止服务`,
            ],
        footer: attached
          ? "↑↓ 选择 · Enter 确认 · Esc 取消 · Ctrl+C 退出面板"
          : "↑↓ 选择 · Enter 确认 · Esc 取消 · Ctrl+C 停止服务",
      });
      return;
    }
    if (page === "stop") {
      terminal.render({
        title: "停止服务确认",
        body: [
          "停止服务会中断在途任务、终端与临时开发服务。",
          "PM2 正式服务与部署不会停止。",
          "",
          `${confirmStop ? "  " : "› "}取消`,
          `${confirmStop ? "› " : "  "}确认停止服务`,
        ],
        footer: "↑↓ 选择 · Enter 确认 · Esc 取消",
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
          ? `待配对 ${status.sessions.pendingPairings} · 活跃会话 ${status.sessions.online}`
          : "",
        ...(attached ? ["附加模式：退出面板后服务继续运行"] : []),
        ...(status?.warnings.map((warning) => `! ${warning}`) ?? []),
        ...(updateNotice ? ["", updateNotice] : []),
        "",
        ...menu.map((label, i) => `${selected === i ? "›" : " "} ${label}`),
        "",
        loading ? "正在刷新…" : error,
      ],
      footer: attached
        ? "↑↓ 选择 · Enter 打开 · p/d/l/a · r 刷新 · q 退出面板"
        : "↑↓ 选择 · Enter 打开 · p/d/l/a · r 刷新 · q 退出",
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
  void deps
    .updateCheck?.()
    .then((notice) => {
      updateNotice = notice ?? "";
      render();
      terminal.notify();
    })
    .catch(() => undefined);
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
      if (page === "stop") {
        if (key.name === "escape") {
          page = "overview";
          render();
        } else if (key.name === "up" || key.name === "down") {
          confirmStop = !confirmStop;
          render();
        } else if (key.name === "return") {
          if (!confirmStop) {
            page = "overview";
            render();
            continue;
          }
          try {
            await client.request("server.shutdown", { confirm: true, source: "tui" }, 5_000);
          } catch (cause) {
            page = "overview";
            error = displayError(cause);
            render();
            continue;
          }
          throw new ServiceStopped();
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
      const shortcuts: Record<string, number> = {
        p: 0,
        d: 1,
        l: 2,
        a: 3,
        q: exitIndex,
      };
      const shortcut = shortcuts[key.name];
      if (shortcut === undefined && key.name !== "return") continue;
      if (shortcut !== undefined) selected = shortcut;
      if (selected === exitIndex) {
        page = "exit";
        confirmExit = false;
        render();
        continue;
      }
      if (attached && selected === 4) {
        page = "stop";
        confirmStop = false;
        render();
        continue;
      }
      ++generation;
      loading = false;
      page = "child";

      const lines: string[] = [];
      const title = menu[selected] ?? "功能";
      const childFooter = attached ? "Esc 返回 · Ctrl+C 退出面板" : "Esc 返回 · Ctrl+C 停止服务";
      const out = (text: string) => {
        lines.push(text);
        terminal.render({ title, body: lines, footer: childFooter });
      };
      const ask = async (message: string) => terminal.ask(message);
      terminal.render({ title, body: ["正在读取…"], footer: childFooter });
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
