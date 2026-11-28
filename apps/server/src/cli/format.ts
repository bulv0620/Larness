import { stripVTControlCharacters } from "node:util";
import type { StatusReport } from "../status.js";

const LEVELS: Record<number, string> = {
  10: "TRACE",
  20: "DEBUG",
  30: "INFO",
  40: "WARN",
  50: "ERROR",
  60: "FATAL",
};

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function describeMode(report: StatusReport): string {
  if (report.mode === null) return "unknown";
  const dev = report.dev ? "dev" : "packaged";
  return `${report.mode} (${dev})`;
}

export function formatStatus(report: StatusReport): string {
  const lines: string[] = [`Larness ${report.version}`];

  if (report.running) {
    const uptime = report.uptimeMs === null ? "" : ` · up ${formatDuration(report.uptimeMs)}`;
    lines.push(`Status   running · pid ${report.pid ?? "unknown"}${uptime}`);
  } else {
    lines.push("Status   not running");
  }

  const host = report.listen.host === "0.0.0.0" ? "localhost" : report.listen.host;
  const origin = report.publicUrl ?? `http://${host}:${report.listen.port}`;
  lines.push(`Web      ${origin}`);
  lines.push(`Data     ${report.dataDir}`);
  lines.push(`Mode     ${describeMode(report)}`);

  if (report.db === null) {
    lines.push("Database not initialized");
  } else {
    lines.push(
      `Database ${report.db.ok ? "ok" : "error"} · schema ${report.db.schemaVersion}${
        report.initialized ? "" : " · not initialized"
      }`,
    );
  }

  if (report.ipc === null) {
    lines.push("IPC      unreachable");
  } else {
    lines.push(`IPC      ok · ${report.ipc.clients} client(s)`);
  }

  lines.push(
    `Sessions ${report.sessions.online} online · ${report.sessions.pendingPairings} pending pairing(s)`,
  );
  lines.push(`Logs     ${report.logPath ?? "none"}`);

  if (report.daemonLogPath !== null) {
    lines.push(`         ${report.daemonLogPath}`);
  }

  lines.push(`PM2      ${report.formalServices.note}`);

  for (const warning of report.warnings) {
    lines.push(`! ${warning}`);
  }

  return `${lines.join("\n")}\n`;
}

export function formatLogLine(line: string): string {
  const cleaned = stripVTControlCharacters(line);

  try {
    const value: unknown = JSON.parse(cleaned);

    if (typeof value === "object" && value !== null && "msg" in value) {
      const record = value as { level?: unknown; time?: unknown; msg?: unknown };
      const level =
        typeof record.level === "number" ? (LEVELS[record.level] ?? String(record.level)) : "INFO";
      const time =
        typeof record.time === "number"
          ? new Date(record.time).toISOString().slice(11, 23)
          : "--:--:--.---";
      const message = typeof record.msg === "string" ? record.msg : JSON.stringify(record.msg);
      return `${time} ${level.padEnd(5)} ${message}`;
    }
  } catch {
    // Not a structured log line; keep the original text.
  }

  return cleaned;
}
