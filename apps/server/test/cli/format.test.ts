import { describe, expect, it } from "vitest";
import { formatLogLine, formatStatus } from "../../src/cli/format.js";
import type { StatusReport } from "../../src/status.js";

const base: StatusReport = {
  version: "1.2.3",
  initialized: true,
  running: true,
  pid: 4242,
  uptimeMs: 3_725_000,
  listen: { host: "127.0.0.1", port: 3210 },
  db: { ok: true, schemaVersion: 12, detail: "ok" },
  ipc: { ok: true, clients: 2, detail: "ok" },
  sessions: { online: 3, pendingPairings: 1 },
  publicUrl: null,
  webauthn: { enabled: true, rpId: "localhost", origin: "http://localhost:3210", reason: null },
  warnings: ["server is not running"],
  dataDir: "/tmp/larness",
  mode: "background",
  dev: false,
  logPath: "/tmp/larness/logs/larness.log",
  daemonLogPath: "/tmp/larness/logs/daemon.log",
  formalServices: {
    managedSeparately: true,
    note: "PM2 services run separately; larness stop does not stop or restart them",
  },
};

describe("status formatting", () => {
  it("renders a readable background summary", () => {
    const text = formatStatus(base);
    expect(text).toContain("Larness 1.2.3");
    expect(text).toContain("running · pid 4242 · up 1h 2m");
    expect(text).toContain("Web      http://127.0.0.1:3210");
    expect(text).toContain("Data     /tmp/larness");
    expect(text).toContain("Mode     background (packaged)");
    expect(text).toContain("Sessions 3 online · 1 pending pairing(s)");
    expect(text).toContain("/tmp/larness/logs/daemon.log");
    expect(text).toContain("PM2 services run separately");
    expect(text).toContain("! server is not running");
  });

  it("marks stopped instances", () => {
    const text = formatStatus({
      ...base,
      running: false,
      pid: null,
      uptimeMs: null,
      mode: null,
      daemonLogPath: null,
    });
    expect(text).toContain("Status   not running");
    expect(text).toContain("Mode     unknown");
    expect(text).not.toContain("daemon.log");
  });

  it("marks foreground dev mode", () => {
    const text = formatStatus({
      ...base,
      mode: "foreground",
      dev: true,
      daemonLogPath: null,
    });
    expect(text).toContain("Mode     foreground (dev)");
  });
});

describe("log line formatting", () => {
  it("formats pino JSON lines", () => {
    const line = JSON.stringify({
      level: 40,
      time: Date.UTC(2026, 0, 2, 3, 4, 5, 6),
      msg: "something happened",
    });
    expect(formatLogLine(line)).toBe("03:04:05.006 WARN  something happened");
  });

  it("keeps unstructured lines and strips terminal controls", () => {
    expect(formatLogLine("plain text")).toBe("plain text");
    expect(formatLogLine("\u001b[31mred\u001b[0m")).toBe("red");
  });
});
