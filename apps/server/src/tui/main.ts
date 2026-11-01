import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import type { InitResult } from "../init/service.js";
import { connectIpc, type IpcClient, IpcClientError } from "../ipc/client.js";
import { resolveDataDir } from "../platform/paths.js";
import { runDashboard } from "./dashboard.js";
import { runInitWizard } from "./init-flow.js";
import { type ManagedRuntime, startManagedRuntime } from "./supervisor.js";

const WEB_DEV_URL = "http://localhost:5173";

interface AttachedOptions {
  dataDir: string;
  runtime?: ManagedRuntime;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionError(error: unknown): boolean {
  return (
    error instanceof IpcClientError &&
    (error.code === "CONNECTION_CLOSED" || error.code === "TIMEOUT")
  );
}

async function runSession(client: IpcClient, options: AttachedOptions): Promise<void> {
  const init = (await client.request("init.status")) as { initialized: boolean };

  if (!init.initialized) {
    console.log(pc.bold("Larness 初始化"));

    const result = await runInitWizard(
      {
        password: () => password({ message: "管理员密码（至少 12 位）", mask: "*" }),
        confirmPassword: () => password({ message: "再次输入管理员密码", mask: "*" }),
        host: () =>
          input({
            message: "监听地址",
            default: options.runtime?.config.config.server.host ?? "127.0.0.1",
          }),
        port: () =>
          input({
            message: "端口",
            default: String(options.runtime?.config.config.server.port ?? 3210),
          }),
        publicUrl: () =>
          input({
            message:
              options.runtime?.dev === true
                ? "公网 URL（开发默认 http://localhost:5173）"
                : "公网 URL（可选；留空则使用 http://localhost:<port>）",
            default: options.runtime?.dev === true ? WEB_DEV_URL : "",
          }),
        channel: () =>
          select({
            message: "更新通道",
            choices: [
              { name: "stable", value: "stable" },
              { name: "beta", value: "beta" },
            ],
            default: "stable",
          }),
        confirm: (summary) => confirm({ message: `${summary}\n确认写入配置？`, default: false }),
        notify: (message) => console.error(pc.yellow(`! ${message}`)),
      },
      async (params) => (await client.request("init.apply", params)) as InitResult,
    );

    console.log(pc.green("初始化完成"));
    console.log(`canonical origin: ${result.origin}`);
    console.log(`RP ID: ${result.rpId}`);

    if (result.restartRequired) {
      console.log(pc.yellow("监听地址 / publicUrl / 更新通道已变化，请退出 TUI 后重新运行。"));
    }
  }

  await runDashboard({
    client,
    out: (text) => console.log(text),
    ask: (message) => input({ message }),
    header:
      options.runtime === undefined
        ? undefined
        : `Server ${options.runtime.serverUrl}  ·  Web ${options.runtime.webUrl}`,
    localLogs: options.runtime?.logs,
    managed: options.runtime !== undefined,
  });
}

async function runAttached(options: AttachedOptions): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const client = await connectIpc({
      dataDir: options.dataDir,
      client: "tui",
      keepAliveMs: 5 * 60_000,
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${pc.red("无法连接本机 IPC")}: ${message}`);
      console.error("请通过 pnpm dev 或 node app.js 启动；TUI 会自动拉起 Server。");
      process.exitCode = 1;
      return null;
    });

    if (client === null) {
      return;
    }

    try {
      await runSession(client, options);
      return;
    } catch (error) {
      if (!isConnectionError(error) || attempt >= 2) {
        throw error;
      }

      console.error(pc.yellow("IPC 连接中断，正在重连…"));
      await delay(1_000);
    } finally {
      client.close();
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const managed = args.includes("--managed") || process.env.LARNESS_TUI_MANAGED === "1";
  const dev = args.includes("--dev") || process.env.LARNESS_TUI_DEV === "1";
  const dataDir = resolveDataDir();
  let runtime: ManagedRuntime | null = null;
  let stopping = false;

  const shutdown = async (label: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(pc.yellow(`\n${label}，正在停止 Server 与 Web…`));
    await runtime?.stop();
    console.log(pc.green("✓ 已停止 Server 与 Web"));
  };

  const onSignal = (signal: "SIGINT" | "SIGTERM" | "SIGHUP"): void => {
    if (stopping) {
      return;
    }

    void shutdown(signal).finally(() => process.exit(0));
  };

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => onSignal(signal));
  }

  try {
    if (managed) {
      runtime = await startManagedRuntime({ dev });
    }

    await runAttached({ dataDir: runtime?.dataDir ?? dataDir, runtime: runtime ?? undefined });
  } finally {
    await runtime?.stop();

    if (runtime !== null) {
      console.log(pc.green("✓ 已停止 Server 与 Web"));
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && error.name === "ExitPromptError") {
    console.log("已取消。");
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[larness] tui failed: ${message}`);
    process.exitCode = 1;
  }
}
