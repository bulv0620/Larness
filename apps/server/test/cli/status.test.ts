import { describe, expect, it } from "vitest";
import { formatStatus } from "../../src/cli/format.js";
import { completeStatus } from "../../src/cli/status.js";
import type { StatusReport } from "../../src/status.js";

const fallback: StatusReport = {
  version: "0.4.3",
  initialized: true,
  running: true,
  pid: 4242,
  uptimeMs: 3_725_000,
  listen: { host: "127.0.0.1", port: 3210 },
  db: { ok: true, schemaVersion: 38, detail: "quick_check ok" },
  ipc: null,
  sessions: { online: 0, pendingPairings: 0 },
  publicUrl: null,
  webauthn: { enabled: true, rpId: "localhost", origin: "http://localhost:3210", reason: null },
  warnings: [],
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

/** Payload from a server built before 112: no dataDir / mode / dev / log paths / PM2 note. */
const legacyPayload = {
  version: "0.4.2",
  initialized: true,
  running: true,
  pid: 17964,
  uptimeMs: 6_712_350,
  listen: { host: "127.0.0.1", port: 3210 },
  db: { ok: true, schemaVersion: 38, detail: "quick_check ok" },
  ipc: { ok: true, clients: 2, detail: "local" },
  sessions: { online: 1, pendingPairings: 0 },
  publicUrl: null,
  webauthn: { enabled: true, rpId: "localhost", origin: "http://localhost:3210", reason: null },
  warnings: [],
};

describe("status IPC fallback", () => {
  it("fills fields an older running server does not return", () => {
    const merged = completeStatus(legacyPayload, fallback);

    expect(merged.dataDir).toBe("/tmp/larness");
    expect(merged.mode).toBe("background");
    expect(merged.dev).toBe(false);
    expect(merged.logPath).toBe("/tmp/larness/logs/larness.log");
    expect(merged.daemonLogPath).toBe("/tmp/larness/logs/daemon.log");
    expect(merged.formalServices.managedSeparately).toBe(true);
    expect(() => formatStatus(merged)).not.toThrow();
  });

  it("keeps the live counts the running server reported", () => {
    const merged = completeStatus(legacyPayload, fallback);

    expect(merged.pid).toBe(17964);
    expect(merged.ipc).toEqual({ ok: true, clients: 2, detail: "local" });
    expect(merged.sessions.online).toBe(1);
  });

  it("does not claim the server is stopped when IPC answered", () => {
    const { warnings: _omitted, ...payloadWithoutWarnings } = legacyPayload;
    const merged = completeStatus(payloadWithoutWarnings, {
      ...fallback,
      warnings: ["server is not running", "config.json is missing"],
    });

    expect(merged.warnings).toEqual(["config.json is missing"]);
  });

  it("keeps the local report when every field is present", () => {
    const remote = { ...fallback, pid: 99, mode: "foreground" as const, dev: true };
    const merged = completeStatus(remote, fallback);

    expect(merged.pid).toBe(99);
    expect(merged.mode).toBe("foreground");
    expect(merged.dev).toBe(true);
  });
});
