import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, expect, it, vi } from "vitest";
import { IpcClientError } from "../../src/ipc/client.js";
import { runResourcePage } from "../../src/tui/resource-pages.js";
import { TerminalInterrupted, TerminalSession } from "../../src/tui/terminal.js";

function fixture() {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  const stdout = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const terminal = new TerminalSession({
    input: stdin as unknown as ReadStream,
    output: stdout as unknown as WriteStream,
    term: "xterm",
  });
  terminal.open();
  return {
    terminal,
    send: (key: string) => stdin.write(key),
    latest: () => output.split("\x1b[2J").at(-1) ?? "",
  };
}
const pair = {
  requestId: "pair_test",
  shortCode: "123456",
  status: "pending",
  decision: null,
  clientLabel: "Test browser",
  clientOrigin: "http://localhost:3210",
  userAgent: "fake",
  createdAt: 1,
  expiresAt: Date.now() + 600_000,
  trustAvailable: true,
};
const device = {
  id: "dev_test",
  label: "Test device",
  createdAt: 1,
  lastSeenAt: null,
  revokedAt: null,
  credentials: [
    {
      id: "cred_test",
      type: "passkey",
      backupEligible: true,
      backupState: false,
      createdAt: 1,
      lastUsedAt: null,
      revokedAt: null,
    },
  ],
};

describe("resource pages", () => {
  it.each(["allow_once", "trust"])(
    "keeps %s code in its own page and never repeats a submitted approval",
    async (decision) => {
      const f = fixture();
      let approved = false;
      let complete: (value: unknown) => void = () => undefined;
      const request = vi.fn(async (method: string) => {
        if (method === "pairing.list") return { requests: approved ? [] : [pair] };
        return new Promise((resolve) => {
          complete = resolve;
        });
      });
      const run = runResourcePage("pairing", { terminal: f.terminal, client: { request } });
      try {
        await vi.waitFor(() => expect(f.latest()).toContain("123456"));
        f.send("\r");
        await vi.waitFor(() => expect(f.latest()).toContain("配对操作"));
        if (decision === "trust") f.send("\x1b[B");
        f.send("\r");
        await vi.waitFor(() => expect(f.latest()).toContain("批准确认"));
        f.send("\r");
        await vi.waitFor(() => expect(f.latest()).toContain("配对操作"));
        expect(request.mock.calls.filter(([m]) => m === "pairing.approve")).toHaveLength(0);
        f.send("\r");
        await vi.waitFor(() => expect(f.latest()).toContain("批准确认"));
        f.send("\x1b[B\r\r\r\x1b");
        await vi.waitFor(() =>
          expect(request).toHaveBeenCalledWith("pairing.approve", {
            requestId: pair.requestId,
            decision,
          }),
        );
        approved = true;
        complete({ code: "ABCDE12345", expiresAt: Date.now() + 300_000 });
        await vi.waitFor(() => expect(f.latest()).toContain("ABCDE-12345"));
        expect(f.latest()).not.toContain("Larness · 控制面板");
        expect(request.mock.calls.filter(([m]) => m === "pairing.approve")).toHaveLength(1);
        f.send("\x1b");
        await vi.waitFor(() => expect(f.latest()).toContain("待审批配对"));
        expect(f.latest()).not.toContain("ABCDE-12345");
        f.send("\x1b");
        await run;
      } finally {
        f.terminal.close();
        await run.catch((error: unknown) => {
          if (!(error instanceof TerminalInterrupted)) throw error;
        });
      }
    },
  );

  it("shows an uncertain write outcome on timeout and only reads state on refresh", async () => {
    const f = fixture();
    const request = vi.fn(async (method: string) => {
      if (method === "pairing.list") return { requests: [pair] };
      throw new IpcClientError("TIMEOUT", "secret exception detail");
    });
    const run = runResourcePage("pairing", { terminal: f.terminal, client: { request } });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("123456"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("配对操作"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("批准确认"));
      f.send("\x1b[B\r");
      await vi.waitFor(() => expect(f.latest()).toContain("结果待确认"));
      expect(f.latest()).not.toContain("secret exception");
      f.send("r");
      await vi.waitFor(() =>
        expect(request.mock.calls.filter(([m]) => m === "pairing.list")).toHaveLength(2),
      );
      expect(request.mock.calls.filter(([m]) => m === "pairing.approve")).toHaveLength(1);
      f.send("\x1b");
      await run;
    } finally {
      f.terminal.close();
      await run.catch((error: unknown) => {
        if (!(error instanceof TerminalInterrupted)) throw error;
      });
    }
  });

  it("allows leaving a pending read and ignores its late response", async () => {
    const f = fixture();
    let resolve: (value: unknown) => void = () => undefined;
    const run = runResourcePage("pairing", {
      terminal: f.terminal,
      client: {
        request: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    f.send("\x1b");
    await run;
    f.terminal.render({ title: "控制面板", body: [], footer: "q 退出" });
    resolve({ requests: [pair] });
    await new Promise((done) => setImmediate(done));
    expect(f.latest()).toContain("控制面板");
    expect(f.latest()).not.toContain("123456");
    f.terminal.close();
  });

  it("keeps revocation results in device detail and disables a repeated revocation", async () => {
    const f = fixture();
    let revoked = false;
    const request = vi.fn(async (method: string) => {
      if (method === "devices.list")
        return { devices: [{ ...device, revokedAt: revoked ? 2 : null }] };
      revoked = true;
      return { ok: true, revokedCredentials: 1, revokedSessions: 2 };
    });
    const run = runResourcePage("devices", { terminal: f.terminal, client: { request } });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("Test device"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("设备详情"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("撤销确认"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("设备详情"));
      expect(request.mock.calls.filter(([m]) => m === "devices.revoke")).toHaveLength(0);
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("撤销确认"));
      f.send("\x1b[B\r");
      await vi.waitFor(() => expect(f.latest()).toContain("已撤销设备"));
      expect(f.latest()).toContain("设备详情");
      f.send("\r\r");
      await new Promise((done) => setImmediate(done));
      expect(request.mock.calls.filter(([m]) => m === "devices.revoke")).toHaveLength(1);
      f.send("\x1b");
      await vi.waitFor(() => expect(f.latest()).toContain("可信设备"));
      f.send("\x1b");
      await run;
    } finally {
      f.terminal.close();
      await run.catch((error: unknown) => {
        if (!(error instanceof TerminalInterrupted)) throw error;
      });
    }
  });
  it("omits trust for unsupported origins and stops offering writes after a confirmed denial", async () => {
    const f = fixture();
    let denied = false;
    const request = vi.fn(async (method: string) => {
      if (method === "pairing.list")
        return { requests: denied ? [] : [{ ...pair, trustAvailable: false }] };
      denied = true;
      return { ok: true };
    });
    const run = runResourcePage("pairing", { terminal: f.terminal, client: { request } });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("123456"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("配对操作"));
      expect(f.latest()).not.toContain("始终允许");
      f.send("\x1b[B\r");
      await vi.waitFor(() => expect(f.latest()).toContain("拒绝确认"));
      f.send("\x1b[B\r");
      await vi.waitFor(() => expect(f.latest()).toContain("已拒绝配对申请"));
      f.send("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("待审批配对"));
      expect(request.mock.calls.filter(([method]) => method === "pairing.deny")).toHaveLength(1);
      expect(request.mock.calls.filter(([method]) => method === "pairing.approve")).toHaveLength(0);
      f.send("\x1b");
      await run;
    } finally {
      f.terminal.close();
      await run.catch((error: unknown) => {
        if (!(error instanceof TerminalInterrupted)) throw error;
      });
    }
  });

  it("rejects invalid data without displaying input details", async () => {
    const f = fixture();
    const run = runResourcePage("devices", {
      terminal: f.terminal,
      client: { request: async () => ({ devices: [{ secret: "private-input" }] }) },
    });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("无法读取或校验"));
      expect(f.latest()).not.toContain("private-input");
      f.send("\x1b");
      await run;
    } finally {
      f.terminal.close();
      await run.catch((error: unknown) => {
        if (!(error instanceof TerminalInterrupted)) throw error;
      });
    }
  });
});
