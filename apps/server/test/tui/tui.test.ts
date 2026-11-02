import { describe, expect, it, vi } from "vitest";
import type { StatusReport } from "../../src/status.js";
import { runDashboard } from "../../src/tui/dashboard.js";
import { type DeviceItem, formatDevices, runDevicesView } from "../../src/tui/devices.js";
import { formatAudit, formatStatus } from "../../src/tui/format.js";
import type { InitPrompts } from "../../src/tui/init-flow.js";
import { runInitWizard } from "../../src/tui/init-flow.js";
import { buildInitRequest, TuiError } from "../../src/tui/init-wizard.js";
import { formatPairingRequests, type PairingItem, runPairingView } from "../../src/tui/pairing.js";

const status: StatusReport = {
  version: "0.0.0",
  initialized: true,
  running: true,
  pid: 123,
  uptimeMs: 1000,
  listen: { host: "127.0.0.1", port: 3210 },
  db: { ok: true, schemaVersion: 2, detail: "quick_check ok" },
  ipc: { ok: true, clients: 1, detail: "local" },
  sessions: { online: 0, pendingPairings: 0 },
  publicUrl: null,
  webauthn: {
    enabled: true,
    rpId: "localhost",
    origin: "http://localhost:3210",
    reason: null,
  },
  warnings: [],
};

function prompts(overrides: Partial<InitPrompts> = {}): InitPrompts {
  return {
    advanced: async () => true,
    host: async () => "127.0.0.1",
    port: async () => "3210",
    publicUrl: async () => "",
    confirm: async () => true,
    ...overrides,
  };
}

describe("TUI init wizard", () => {
  it("builds an init request with a canonical origin preview", () => {
    const request = buildInitRequest({
      host: "127.0.0.1",
      port: "3210",
      publicUrl: "https://larness.example.com",
    });

    expect(request.params).toMatchObject({
      host: "127.0.0.1",
      port: 3210,
      publicUrl: "https://larness.example.com",
    });
    expect(request.origin).toBe("https://larness.example.com");
    expect(request.rpId).toBe("larness.example.com");
    expect(request.passkeyEnabled).toBe(true);
    expect(request.warning).toBeNull();

    const remote = buildInitRequest({
      host: "127.0.0.1",
      port: "3210",
      publicUrl: "http://192.168.1.10:3210",
    });
    expect(remote.passkeyEnabled).toBe(false);
    expect(remote.warning).toContain("Passkey 不可用");
  });

  it("rejects invalid hosts and ports", () => {
    expect(() => buildInitRequest({ host: "", port: "3210", publicUrl: "" })).toThrow(TuiError);
    expect(() => buildInitRequest({ host: "127.0.0.1", port: "70000", publicUrl: "" })).toThrow(
      /端口/,
    );
  });

  it("applies the collected answers through the IPC callback", async () => {
    const apply = vi.fn(async () => ({
      origin: "http://localhost:3210",
      rpId: "localhost",
      restartRequired: true,
    }));

    const result = await runInitWizard(prompts(), apply);

    expect(result.restartRequired).toBe(true);
    expect(apply).toHaveBeenCalledWith({});
  });

  it("notifies and retries after invalid input", async () => {
    const notify = vi.fn();
    let attempt = 0;
    const apply = vi.fn(async () => ({
      origin: "http://localhost:3210",
      rpId: "localhost",
      restartRequired: false,
    }));

    await runInitWizard(
      prompts({
        port: async () => {
          attempt += 1;
          return attempt === 1 ? "70000" : "3210";
        },
        notify,
      }),
      apply,
    );

    expect(notify).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not apply when the user cancels the summary", async () => {
    const apply = vi.fn();
    await expect(runInitWizard(prompts({ confirm: async () => false }), apply)).rejects.toThrow(
      /取消/,
    );
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("TUI pairing view", () => {
  const item: PairingItem = {
    requestId: "pair_1",
    shortCode: "123456",
    status: "pending",
    decision: null,
    clientLabel: "Chrome",
    clientOrigin: "http://localhost:3210",
    userAgent: "test-agent",
    createdAt: 0,
    expiresAt: 600_000,
    trustAvailable: true,
  };

  it("formats pending requests with origin and trust availability", () => {
    const text = formatPairingRequests([item, { ...item, trustAvailable: false }]);
    expect(text).toContain("123456");
    expect(text).toContain("http://localhost:3210");
    expect(text).toContain("可用");
    expect(text).toContain("不可用");
    expect(formatPairingRequests([])).toContain("无");
  });

  it("approves a request and shows the one-time code", async () => {
    const output: string[] = [];
    const answers = ["123456", "a", "y"];
    let approvals = 0;

    const client = {
      request: async (method: string) => {
        if (method === "pairing.list") {
          return { requests: [item] };
        }
        if (method === "pairing.approve") {
          approvals += 1;
          return { code: "abcde12345", expiresAt: 0 };
        }
        return { ok: true };
      },
    };

    await runPairingView({
      client,
      out: (text) => output.push(text),
      ask: async () => answers.shift() ?? "",
    });

    expect(approvals).toBe(1);
    expect(output.join("\n")).toContain("ABCDE-12345");
  });

  it("refuses trust for non-canonical requests", async () => {
    const output: string[] = [];
    const answers = ["123456", "t"];
    let approvals = 0;

    const client = {
      request: async (method: string) => {
        if (method === "pairing.list") {
          return { requests: [{ ...item, trustAvailable: false }] };
        }
        approvals += 1;
        return { ok: true };
      },
    };

    await runPairingView({
      client,
      out: (text) => output.push(text),
      ask: async () => answers.shift() ?? "",
    });

    expect(approvals).toBe(0);
    expect(output.join("\n")).toContain("不支持始终允许");
  });

  it("denies a request after confirmation", async () => {
    const output: string[] = [];
    const answers = ["123456", "d", "y"];
    let denied = 0;

    const client = {
      request: async (method: string) => {
        if (method === "pairing.list") {
          return { requests: [item] };
        }
        if (method === "pairing.deny") {
          denied += 1;
        }
        return { ok: true };
      },
    };

    await runPairingView({
      client,
      out: (text) => output.push(text),
      ask: async () => answers.shift() ?? "",
    });

    expect(denied).toBe(1);
    expect(output.join("\n")).toContain("已拒绝");
  });
});

describe("TUI device view", () => {
  const device: DeviceItem = {
    id: "dev_1",
    label: "MacBook",
    createdAt: 0,
    lastSeenAt: 100,
    revokedAt: null,
    credentials: [
      {
        id: "cred_1",
        type: "passkey",
        backupEligible: true,
        backupState: true,
        createdAt: 0,
        lastUsedAt: 100,
        revokedAt: null,
      },
    ],
  };

  it("formats devices with backup flags and status", () => {
    const text = formatDevices([device, { ...device, id: "dev_2", revokedAt: 5 }]);
    expect(text).toContain("MacBook");
    expect(text).toContain("backup eligible=true");
    expect(text).toContain("active");
    expect(text).toContain("revoked");
    expect(formatDevices([])).toContain("无");
  });

  it("revokes a device after confirmation", async () => {
    const output: string[] = [];
    const answers = ["1", "y"];
    let revoked = 0;

    const client = {
      request: async (method: string) => {
        if (method === "devices.list") {
          return { devices: [device] };
        }
        if (method === "devices.revoke") {
          revoked += 1;
          return { revokedCredentials: 1, revokedSessions: 2 };
        }
        return {};
      },
    };

    await runDevicesView({
      client,
      out: (text) => output.push(text),
      ask: async () => answers.shift() ?? "",
    });

    expect(revoked).toBe(1);
    expect(output.join("\n")).toContain("credential 1 个");
  });
});

describe("TUI formatting and dashboard", () => {
  it("renders status and audit summaries", () => {
    const text = formatStatus(status);
    expect(text).toContain("Larness");
    expect(text).toContain("数据库");
    expect(text).toContain("schema 2");
    expect(text).toContain("localhost:3210");
    expect(formatAudit([])).toContain("无");
    expect(
      formatAudit([
        {
          id: "aud_1",
          action: "auth.init",
          decision: "allow",
          resourceType: null,
          resourceId: null,
          createdAt: 0,
          details: {},
        },
      ]),
    ).toContain("auth.init");
  });

  it("refreshes the dashboard, shows logs, and exits on q", async () => {
    const output: string[] = [];
    const answers = ["l", "q"];
    const client = {
      request: async (method: string) => {
        if (method === "system.status") {
          return status;
        }
        if (method === "logs.tail") {
          return { lines: ["log-line-1"] };
        }
        return { items: [] };
      },
    };

    await runDashboard({
      client,
      out: (text) => output.push(text),
      ask: async () => answers.shift() ?? "q",
      header: "Server http://localhost:3210 · Web http://localhost:5173",
      localLogs: () => ["[web] web-line-1"],
      managed: true,
    });

    expect(output.join("\n")).toContain("Larness");
    expect(output.join("\n")).toContain("Server http://localhost:3210");
    expect(output.join("\n")).toContain("最近审计");
    expect(output.join("\n")).toContain("log-line-1");
    expect(output.join("\n")).toContain("web-line-1");
  });
});
