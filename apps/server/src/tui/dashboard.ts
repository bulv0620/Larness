import type { IpcClient } from "../ipc/client.js";
import type { StatusReport } from "../status.js";
import { type AuditTailItem, formatAudit, formatStatus } from "./format.js";

export interface DashboardDeps {
  client: Pick<IpcClient, "request">;
  out(text: string): void;
  ask(message: string): Promise<string>;
}

export async function runDashboard(deps: DashboardDeps): Promise<void> {
  for (;;) {
    const status = (await deps.client.request("system.status")) as StatusReport;
    const audit = (await deps.client.request("audit.tail", { limit: 10 })) as {
      items: AuditTailItem[];
    };

    deps.out(formatStatus(status));
    deps.out(formatAudit(audit.items));

    const answer = (await deps.ask("Enter 刷新 / l 日志 / q 退出 / s 关闭 server: "))
      .trim()
      .toLowerCase();

    if (answer === "q") {
      return;
    }

    if (answer === "l") {
      const logs = (await deps.client.request("logs.tail", { lines: 20 })) as { lines: string[] };
      deps.out(logs.lines.length === 0 ? "最近日志: 无" : `最近日志:\n${logs.lines.join("\n")}`);
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
