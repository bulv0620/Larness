import pc from "picocolors";
import type { StatusReport } from "../status.js";

export interface AuditTailItem {
  id: string;
  action: string;
  decision: string | null;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: number;
  details: unknown;
}

export function formatStatus(status: StatusReport): string {
  const lines = [
    `${pc.bold("Larness")} ${status.version}`,
    `状态: ${status.running ? pc.green("running") : pc.yellow("stopped")}`,
    `初始化: ${status.initialized ? "yes" : "no"}`,
    `监听: ${status.listen.host}:${status.listen.port}`,
    `数据库: ${
      status.db === null
        ? "未初始化"
        : `${status.db.ok ? "ok" : "fail"} (schema ${status.db.schemaVersion})`
    }`,
    `IPC: ${status.ipc === null ? "不可用" : `${status.ipc.clients} 个客户端`}`,
    `WebAuthn: ${status.webauthn.enabled ? "enabled" : "disabled"} (${status.webauthn.origin})`,
    `会话: ${status.sessions.online} 活跃 / ${status.sessions.pendingPairings} 待审批`,
  ];

  if (status.warnings.length > 0) {
    lines.push("", ...status.warnings.map((warning) => `${pc.yellow("!")} ${warning}`));
  }

  return lines.join("\n");
}

export function formatAudit(items: AuditTailItem[]): string {
  if (items.length === 0) {
    return "最近审计: 无";
  }

  const lines = ["最近审计:"];

  for (const item of items) {
    const time = new Date(item.createdAt).toISOString();
    const decision = item.decision === null ? "" : ` [${item.decision}]`;
    lines.push(`  ${time} ${item.action}${decision}`);
  }

  return lines.join("\n");
}
