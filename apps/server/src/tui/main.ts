import { confirm, input, password, select } from "@inquirer/prompts";
import pc from "picocolors";
import type { InitResult } from "../init/service.js";
import { connectIpc } from "../ipc/client.js";
import { resolveDataDir } from "../platform/paths.js";
import { runDashboard } from "./dashboard.js";
import { runInitWizard } from "./init-flow.js";

async function main(): Promise<void> {
  const dataDir = resolveDataDir();
  const client = await connectIpc({ dataDir, client: "tui" }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${pc.red("无法连接本机 IPC")}: ${message}`);
    console.error("请先启动 server（pnpm dev:server 或 pnpm dev）。");
    process.exitCode = 1;
    return null;
  });

  if (client === null) {
    return;
  }

  try {
    const init = (await client.request("init.status")) as { initialized: boolean };

    if (!init.initialized) {
      console.log(pc.bold("Larness 初始化"));

      const result = await runInitWizard(
        {
          password: () => password({ message: "管理员密码（至少 12 位）", mask: "*" }),
          confirmPassword: () => password({ message: "再次输入管理员密码", mask: "*" }),
          host: () => input({ message: "监听地址", default: "127.0.0.1" }),
          port: () => input({ message: "端口", default: "3210" }),
          publicUrl: () =>
            input({
              message: "公网 URL（可选；留空则使用 http://localhost:<port>）",
              default: "",
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
        console.log(pc.yellow("监听地址 / publicUrl / 更新通道已变化，请重启 server。"));
      }
    } else {
      await runDashboard({
        client,
        out: (text) => console.log(text),
        ask: (message) => input({ message }),
      });
    }
  } finally {
    client.close();
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
