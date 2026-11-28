import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { describe, expect, it, vi } from "vitest";
import { ServiceStopped } from "../../src/tui/page-error.js";
import { runScreenDashboard } from "../../src/tui/screen-dashboard.js";
import { TerminalSession } from "../../src/tui/terminal.js";

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
  return { stdin, terminal, latest: () => output.split("\x1b[2J").at(-1) ?? "" };
}
const status = {
  version: "test",
  initialized: true,
  running: true,
  listen: { host: "localhost", port: 3210 },
  sessions: { online: 2, pendingPairings: 1 },
  warnings: [],
};

describe("screen dashboard", () => {
  it("requires explicit exit confirmation, defaults to cancel, and avoids loading audit on overview", async () => {
    const f = fixture();
    const request = vi.fn(async () => status);
    const run = runScreenDashboard({ terminal: f.terminal, client: { request } });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("活跃会话 2"));
      expect(request).toHaveBeenCalledTimes(1);
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("控制面板"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
    } finally {
      f.terminal.close();
    }
  });

  it("shows an npm update notice without blocking the overview", async () => {
    const f = fixture();
    const run = runScreenDashboard({
      terminal: f.terminal,
      client: { request: async () => status },
      updateCheck: async () => "有新版本 0.2.0（当前 0.1.0）· 运行 npm install -g larness@latest",
    });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("有新版本 0.2.0"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
    } finally {
      f.terminal.close();
    }
  });

  it("labels attached mode and exits without stopping the service", async () => {
    const f = fixture();
    const request = vi.fn(async () => status);
    const run = runScreenDashboard({ terminal: f.terminal, client: { request }, attached: true });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("附加模式：退出面板后服务继续运行"));
      expect(f.latest()).toContain("退出面板");
      expect(f.latest()).not.toContain("（服务继续运行）");
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出面板不会停止服务"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
      expect(request).not.toHaveBeenCalledWith(
        "server.shutdown",
        expect.anything(),
        expect.anything(),
      );
    } finally {
      f.terminal.close();
    }
  });

  it("keeps the default exit choice on cancel so Enter returns to the panel", async () => {
    const f = fixture();
    const request = vi.fn(async () => status);
    const run = runScreenDashboard({ terminal: f.terminal, client: { request }, attached: true });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("附加模式"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      expect(f.latest()).toContain("› 取消");
      expect(f.latest()).not.toContain("› 退出面板");
      f.stdin.write("\x1b[B");
      await vi.waitFor(() => expect(f.latest()).toContain("› 退出面板"));
      expect(f.latest()).not.toContain("› 取消");
      f.stdin.write("\x1b[A");
      await vi.waitFor(() => expect(f.latest()).toContain("› 取消"));
      f.stdin.write("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("控制面板"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
    } finally {
      f.terminal.close();
    }
  });

  it("marks exactly one exit choice in foreground mode", async () => {
    const f = fixture();
    const request = vi.fn(async () => status);
    const run = runScreenDashboard({ terminal: f.terminal, client: { request } });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("活跃会话"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      expect(f.latest()).toContain("› 取消");
      expect(f.latest()).not.toContain("› 确认退出并停止服务");
      f.stdin.write("\x1b[B");
      await vi.waitFor(() => expect(f.latest()).toContain("› 确认退出并停止服务"));
      expect(f.latest()).not.toContain("› 取消");
      f.stdin.write("\x1b[A");
      f.stdin.write("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("控制面板"));
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
    } finally {
      f.terminal.close();
    }
  });

  it("confirms an attached-mode stop and sends the TUI source", async () => {
    const f = fixture();
    const request = vi.fn(async (method: string) =>
      method === "server.shutdown" ? { ok: true } : status,
    );
    const run = runScreenDashboard({ terminal: f.terminal, client: { request }, attached: true });
    try {
      await vi.waitFor(() => expect(f.latest()).toContain("附加模式"));
      for (let index = 0; index < 4; index += 1) f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await vi.waitFor(() => expect(f.latest()).toContain("停止服务确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await expect(run).rejects.toBeInstanceOf(ServiceStopped);
      expect(request).toHaveBeenCalledWith(
        "server.shutdown",
        { confirm: true, source: "tui" },
        5_000,
      );
    } finally {
      f.terminal.close();
    }
  });

  it("ignores a read response that arrives after the dashboard has exited", async () => {
    const f = fixture();
    let resolve: (value: unknown) => void = () => undefined;
    const run = runScreenDashboard({
      terminal: f.terminal,
      client: {
        request: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
    });
    try {
      f.stdin.write("q");
      await vi.waitFor(() => expect(f.latest()).toContain("退出确认"));
      f.stdin.write("\x1b[B");
      f.stdin.write("\r");
      await run;
      const before = f.latest();
      resolve(status);
      await new Promise((done) => setImmediate(done));
      expect(f.latest()).toBe(before);
    } finally {
      f.terminal.close();
    }
  });
});
