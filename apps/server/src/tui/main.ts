import { setTimeout as delay } from "node:timers/promises";
import { confirm } from "@inquirer/prompts";
import { inspectInstanceLock } from "../bootstrap/lock.js";
import { DevWebUnavailable } from "../dev-web/control.js";
import type { IpcClient } from "../ipc/client.js";
import { connectIpc, IpcClientError } from "../ipc/client.js";
import { checkForUpdate, updateChannel, updateNoticeText } from "../modules/updates/npm.js";
import { resolveDataDir } from "../platform/paths.js";
import { SERVER_VERSION } from "../version.js";
import { InitCancelled, runInitWizard } from "./init-flow.js";
import { runManagedSessions, type SessionAction } from "./lifecycle.js";
import { ServiceStopped } from "./page-error.js";
import { InitResultSchema, InitStatusSchema } from "./schemas.js";
import { safeText } from "./screen.js";
import { displayError, runScreenDashboard } from "./screen-dashboard.js";
import { type ManagedRuntime, startManagedRuntime } from "./supervisor.js";
import { NavigationCancelled, TerminalInterrupted, TerminalSession } from "./terminal.js";

async function runSession(
  client: IpcClient,
  runtime: ManagedRuntime | undefined,
  terminal: TerminalSession,
  attached: boolean,
): Promise<SessionAction> {
  const init = InitStatusSchema.parse(await client.request("init.status"));
  const interruptLabel = attached ? "Ctrl+C 退出面板" : "Ctrl+C 停止服务";
  if (!init.initialized) {
    const current = runtime?.config.config.server;
    terminal.render({
      title: "初始化",
      body: ["确认当前设置后初始化本机工作空间。", `Web：${runtime?.webUrl ?? "本机"}`],
      footer: `Enter 选择 · Esc 取消 · ${interruptLabel}`,
    });
    const result = await runInitWizard(
      {
        advanced: () =>
          terminal.prompt((context) =>
            confirm({ message: "修改高级网络设置？", default: false }, context),
          ),
        host: () => terminal.ask("监听地址", current?.host ?? "127.0.0.1"),
        port: () => terminal.ask("端口", String(current?.port ?? 3210)),
        publicUrl: () => terminal.ask("浏览器访问地址（可留空）", current?.publicUrl ?? ""),
        confirm: (summary) => {
          terminal.render({
            title: "初始化确认",
            body: summary.split("\n"),
            footer: `Enter 确认 · Esc 取消 · ${interruptLabel}`,
          });
          return terminal.prompt((context) =>
            confirm({ message: "确认写入配置？", default: false }, context),
          );
        },
        notify: (message) =>
          terminal.render({
            title: "初始化",
            body: [message],
            footer: `请重新输入 · Esc 返回 · ${interruptLabel}`,
          }),
      },
      async (params) => {
        terminal.render({ title: "初始化", body: ["正在保存配置…"], footer: interruptLabel });
        return InitResultSchema.parse(await client.request("init.apply", params));
      },
      {
        config: runtime?.config.config,
        env: process.env,
      },
    );
    if (result.restartRequired) {
      if (runtime === undefined) {
        terminal.render({
          title: "应用配置",
          body: [
            "配置已保存，需要重启管理面才会生效。",
            "当前控制面板是附加模式，不会自动停止服务。",
            "",
            "请在终端执行：larness restart",
          ],
          footer: "按回车退出面板 · 服务继续运行",
        });
        await terminal.nextKey();
        return "done";
      }
      terminal.render({
        title: "应用配置",
        body: ["配置已保存，正在重启 Server 与 Web…"],
        footer: "Ctrl+C 停止服务",
      });
      return runtime ? "restart" : "done";
    }
  }
  await runScreenDashboard({
    terminal,
    client,
    webUrl: runtime?.webUrl,
    localLogs: runtime?.logs,
    attached,
    updateCheck: async () => {
      const notice = await checkForUpdate({
        version: SERVER_VERSION,
        dataDir: runtime?.dataDir ?? resolveDataDir(),
        channel: updateChannel(runtime?.config.config.updates.channel),
      });
      return notice === null ? null : updateNoticeText(notice);
    },
  });
  return "done";
}

async function waitForCleanStop(timeoutMs = 5_000): Promise<boolean> {
  const dataDir = resolveDataDir();
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if ((await inspectInstanceLock(dataDir)) === null) return true;
    if (Date.now() >= deadline) return false;
    await delay(150);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const attachOnly = args.includes("--attach");
  const managed =
    !attachOnly && (args.includes("--managed") || process.env.LARNESS_TUI_MANAGED === "1");
  const dev = args.includes("--dev") || process.env.LARNESS_TUI_DEV === "1";
  const terminal = new TerminalSession();
  const abort = new AbortController();
  let runtime: ManagedRuntime | null = null;
  let activeClient: IpcClient | null = null;
  let stopping: Promise<void> | null = null;
  const stop = () => {
    abort.abort();
    terminal.interrupt();
    activeClient?.close();
    stopping ??= runtime?.stop() ?? Promise.resolve();
  };
  terminal.onInterrupt = stop;
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  for (const signal of signals) process.on(signal, stop);
  // Install handlers before the first alternate-screen write: a terminal can
  // receive SIGTERM as soon as it becomes visible, even before children start.
  try {
    terminal.open();
  } catch (error) {
    for (const signal of signals) process.off(signal, stop);
    throw error;
  }

  const attach = async (current?: ManagedRuntime): Promise<SessionAction> => {
    for (let attempt = 0; ; attempt += 1) {
      abort.signal.throwIfAborted();
      let client: IpcClient | null = null;
      let release: () => void = () => undefined;
      try {
        client = await connectIpc({
          dataDir: current?.dataDir ?? resolveDataDir(),
          client: "tui",
          keepAliveMs: 5 * 60_000,
        }).catch((error: unknown) => {
          if (error instanceof IpcClientError) throw error;
          throw new IpcClientError("CONNECTION_CLOSED", "无法连接本机 IPC");
        });
        activeClient = client;
        release = client.onClose(() => {
          if (abort.signal.aborted) return;
          serverGone = true;
          terminal.interrupt();
        });
        return await runSession(client, current, terminal, !managed);
      } catch (error) {
        if (abort.signal.aborted) throw new TerminalInterrupted();
        if (
          !(error instanceof IpcClientError) ||
          !["CONNECTION_CLOSED", "TIMEOUT"].includes(error.code) ||
          attempt >= 2
        )
          throw error;
        terminal.render({
          title: "重新连接",
          body: ["本机连接中断，正在重新连接…", "未确认的写操作不会自动重试。"],
          footer: managed ? "Ctrl+C 停止服务" : "Ctrl+C 退出面板",
        });
        await delay(1_000, undefined, { signal: abort.signal });
      } finally {
        release();
        client?.close();
        activeClient = null;
      }
    }
  };
  let failure: unknown;
  let cleanStop = false;
  let serverGone = false;
  try {
    if (managed) {
      await runManagedSessions({
        start: () =>
          startManagedRuntime({
            dev,
            signal: abort.signal,
            out: (text) =>
              terminal.render({
                title: "启动检查",
                body: safeText(text).split("\n"),
                footer: "Ctrl+C 停止服务",
              }),
          }),
        attach: async (value) => {
          try {
            return await Promise.race([
              attach(value),
              value.devFailed.then(() => {
                throw new DevWebUnavailable();
              }),
            ]);
          } catch (error) {
            terminal.interrupt();
            throw error;
          }
        },
        onRuntime: (value) => {
          runtime = value;
        },
      });
    } else {
      await attach();
    }
  } catch (error) {
    if (serverGone) {
      cleanStop = await waitForCleanStop();
      if (!cleanStop) {
        failure = new Error("服务连接中断，但实例锁仍存在；请查看日志后重新执行 larness tui。");
      }
    } else if (
      !(error instanceof TerminalInterrupted) &&
      !(error instanceof NavigationCancelled) &&
      !(error instanceof InitCancelled) &&
      !abort.signal.aborted
    ) {
      if (error instanceof ServiceStopped) {
        cleanStop = await waitForCleanStop();
        if (!cleanStop) {
          failure = new Error("停止请求已发送，但服务在超时前没有释放实例锁；请查看日志。");
        }
      } else if (error instanceof IpcClientError && error.code === "CONNECTION_CLOSED") {
        cleanStop = await waitForCleanStop();
        if (!cleanStop) {
          failure = new Error("服务连接中断，但实例锁仍存在；请查看日志后重新执行 larness tui。");
        }
      } else {
        failure = error;
      }
    }
  } finally {
    try {
      await stopping;
    } catch (error) {
      failure ??= error;
    } finally {
      for (const signal of signals) process.off(signal, stop);
      terminal.close();
    }
  }
  if (failure !== undefined) {
    console.error(`[larness] ${displayError(failure)}`);
    process.exitCode = 1;
  } else if (cleanStop) {
    console.log("服务已停止，控制面板已退出。");
  } else if (!managed) {
    console.log("控制面板已退出，服务继续运行。");
  } else {
    console.log("Larness 已退出，Server 与 Web 已停止。");
  }
}

try {
  await main();
} catch (error) {
  console.error(`[larness] ${error instanceof Error ? safeText(error.message) : "TUI 启动失败"}`);
  process.exitCode = 1;
}
