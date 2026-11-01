import { describe, expect, it, vi } from "vitest";
import type { StatusReport } from "../../src/status.js";
import { runDashboard } from "../../src/tui/dashboard.js";
import { formatAudit, formatStatus } from "../../src/tui/format.js";
import type { InitPrompts } from "../../src/tui/init-flow.js";
import { runInitWizard } from "../../src/tui/init-flow.js";
import { buildInitRequest, TuiError } from "../../src/tui/init-wizard.js";
import { formatPairingRequests, type PairingItem, runPairingView } from "../../src/tui/pairing.js";

const PASSWORD = "correct horse battery staple";

const status: StatusReport = {
  version: "0.0.0",
  initialized: true,
  running: true,
  pid: 123,
  uptimeMs: 1000,
  listen: { host: "127.0.0.1", port: 3210 },
  db: { ok: true, schemaVersion: 1, detail: "quick_check ok" },
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
    password: async () => PASSWORD,
    confirmPassword: async () => PASSWORD,
    host: async () => "127.0.0.1",
    port: async () => "3210",
    publicUrl: async () => "",
    channel: async () => "stable",
    confirm: async () => true,
    ...overrides,
  };
}

describe("TUI init wizard", () => {
  it("builds an init request with a canonical origin preview", () => {
    const request = buildInitRequest({
      password: PASSWORD,
      confirmPassword: PASSWORD,
      host: "127.0.0.1",
      port: "3210",
      publicUrl: "https://larness.example.com",
      channel: "stable",
    });

    expect(request.params).toMatchObject({
      adminPassword: PASSWORD,
      host: "127.0.0.1",
      port: 3210,
      publicUrl: "https://larness.example.com",
    });
    expect(request.origin).toBe("https://larness.example.com");
    expect(request.rpId).toBe("larness.example.com");
    expect(request.passkeyEnabled).toBe(true);
    expect(request.warning).toBeNull();

    const remote = buildInitRequest({
      password: PASSWORD,
      confirmPassword: PASSWORD,
      host: "127.0.0.1",
      port: "3210",
      publicUrl: "http://192.168.1.10:3210",
      channel: "stable",
    });
    expect(remote.passkeyEnabled).toBe(false);
    expect(remote.warning).toContain("Passkey 不可用");
  });

  it("rejects mismatched passwords and invalid ports", () => {
    expect(() =>
      buildInitRequest({
        password: PASSWORD,
        confirmPassword: `${PASSWORD}x`,
        host: "127.0.0.1",
        port: "3210",
        publicUrl: "",
        channel: "stable",
      }),
    ).toThrow(TuiError);

    expect(() =>
      buildInitRequest({
        password: PASSWORD,
        confirmPassword: PASSWORD,
        host: "127.0.0.1",
        port: "70000",
        publicUrl: "",
        channel: "stable",
      }),
    ).toThrow(/端口/);
  });

  it("applies the collected answers through the IPC callback", async () => {
    const apply = vi.fn(async () => ({
      origin: "http://localhost:3210",
      rpId: "localhost",
      restartRequired: true,
    }));

    const result = await runInitWizard(prompts(), apply);

    expect(result.restartRequired).toBe(true);
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ host: "127.0.0.1", port: 3210, channel: "stable" }),
    );
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
        password: async () => {
          attempt += 1;
          return attempt === 1 ? "short" : PASSWORD;
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

describe("TUI formatting and dashboard", () => {
  it("renders status and audit summaries", () => {
    const text = formatStatus(status);
    expect(text).toContain("Larness");
    expect(text).toContain("数据库");
    expect(text).toContain("schema 1");
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
    });

    expect(output.join("\n")).toContain("Larness");
    expect(output.join("\n")).toContain("最近审计");
    expect(output.join("\n")).toContain("log-line-1");
  });
});
