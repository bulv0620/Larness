import type { IpcClient } from "../ipc/client.js";
import type { StatusReport } from "../status.js";
import { runDevicesView } from "./devices.js";
import { type AuditTailItem, formatAudit, formatStatus } from "./format.js";
import { runPairingView } from "./pairing.js";

export interface DashboardDeps {
  client: Pick<IpcClient, "request">;
  out(text: string): void;
  ask(message: string): Promise<string>;
  header?: string;
  localLogs?: () => string[];
  managed?: boolean;
}

export async function runDashboard(deps: DashboardDeps): Promise<void> {
  let headerPrinted = false;

  for (;;) {
    if (!headerPrinted && deps.header !== undefined) {
      deps.out(deps.header);
      headerPrinted = true;
    }

    const status = (await deps.client.request("system.status")) as StatusReport;
    const audit = (await deps.client.request("audit.tail", { limit: 10 })) as {
      items: AuditTailItem[];
    };

    deps.out(formatStatus(status));
    deps.out(formatAudit(audit.items));

    const answer = (
      await deps.ask(
        deps.managed === true
          ? "Enter 刷新 / p 配对 / d 设备 / l 日志 / q 退出（停止服务） / s 关闭 server: "
          : "Enter 刷新 / p 配对 / d 设备 / l 日志 / q 退出 / s 关闭 server: ",
      )
    )
      .trim()
      .toLowerCase();

    if (answer === "q") {
      return;
    }

    if (answer === "d") {
      await runDevicesView({ client: deps.client, out: deps.out, ask: deps.ask });
      continue;
    }

    if (answer === "p") {
      await runPairingView({ client: deps.client, out: deps.out, ask: deps.ask });
      continue;
    }

    if (answer === "l") {
      const logs = (await deps.client.request("logs.tail", { lines: 20 })) as { lines: string[] };
      const local = deps.localLogs?.() ?? [];
      const sections: string[] = [];

      if (local.length > 0) {
        sections.push(`子进程输出:\n${local.join("\n")}`);
      }

      sections.push(
        logs.lines.length === 0
          ? "Server 最近日志: 无"
          : `Server 最近日志:\n${logs.lines.join("\n")}`,
      );
      deps.out(sections.join("\n\n"));
      continue;
    }

    if (answer === "s") {
      const confirmation = (await deps.ask("输入 yes 确认关闭 server: ")).trim().toLowerCase();

      if (confirmation === "yes") {
        await deps.client.request("server.shutdown", { confirm: true });
        deps.out("已请求关闭 server");
        return;
      }
    }
  }
}
