import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { expect, it, vi } from "vitest";
import { IpcClientError } from "../../src/ipc/client.js";
import { runReadingPage } from "../../src/tui/reading-page.js";
import { TerminalInterrupted, TerminalSession } from "../../src/tui/terminal.js";

function fixture() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  const output = Object.assign(new PassThrough(), { isTTY: true, columns: 80, rows: 24 });
  let text = "";
  output.on("data", (chunk) => {
    text += String(chunk);
  });
  const terminal = new TerminalSession({
    input: input as unknown as ReadStream,
    output: output as unknown as WriteStream,
    term: "xterm",
  });
  terminal.open();
  return { terminal, input, latest: () => text.split("\x1b[2J").at(-1) ?? "" };
}
const lines = (count: number) =>
  Array.from({ length: count }, (_, i) => `row-${String(i).padStart(3, "0")}`);

it("keeps the log bottom on refresh and preserves a non-bottom visual offset", async () => {
  const f = fixture();
  let count = 50;
  const request = vi.fn(async () => ({ lines: lines(count) }));
  const run = runReadingPage("logs", { terminal: f.terminal, client: { request } });
  try {
    await vi.waitFor(() => expect(f.latest()).toContain("row-049"));
    count = 60;
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("row-059"));
    f.input.write("\x1b[H\x1b[6~");
    await vi.waitFor(() => expect(f.latest()).toContain("row-019"));
    count = 80;
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("80行"));
    expect(f.latest()).toContain("row-019");
    expect(f.latest()).not.toContain("row-079");
    f.input.write("\x1b");
    await run;
  } finally {
    f.terminal.close();
    await run.catch((e) => {
      if (!(e instanceof TerminalInterrupted)) throw e;
    });
  }
});

it("shows genuine empty snapshots separately from invalid payloads and releases on connection failure", async () => {
  const f = fixture();
  const request = vi
    .fn()
    .mockResolvedValueOnce({ items: [] })
    .mockResolvedValueOnce({ items: "invalid secret" })
    .mockRejectedValueOnce(new IpcClientError("CONNECTION_CLOSED", "private"));
  const run = runReadingPage("audit", { terminal: f.terminal, client: { request } });
  // Attach the rejection handler before injecting the disconnect.
  const outcome = run.catch((error) => error);
  try {
    await vi.waitFor(() => expect(f.latest()).toContain("暂无审计记录"));
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("刷新失败，当前为上次快照"));
    expect(f.latest()).not.toContain("invalid secret");
    f.input.write("r");
    expect(await outcome).toMatchObject({ code: "CONNECTION_CLOSED" });
  } finally {
    f.terminal.close();
    await outcome;
  }
});

it("takes bounded snapshots, starts logs at bottom, and preserves independent source positions without requests", async () => {
  const f = fixture();
  const request = vi.fn(async () => ({ lines: lines(200) }));
  let local = lines(400).map((x) => `[web] ${x}`);
  const run = runReadingPage("logs", {
    terminal: f.terminal,
    client: { request },
    localLogs: () => local,
  });
  try {
    await vi.waitFor(() => expect(f.latest()).toContain("row-199"));
    expect(request).toHaveBeenCalledWith("logs.tail", { lines: 200 });
    f.input.write("\x1b[H");
    await vi.waitFor(() => expect(f.latest()).toContain("row-000"));
    f.input.write("\x1b[C");
    await vi.waitFor(() => expect(f.latest()).toContain("row-399"));
    expect(f.latest()).toContain("300行");
    local = ["new background output"];
    f.input.write("\x1b[D");
    await vi.waitFor(() => expect(f.latest()).toContain("row-000"));
    f.input.write("\x1b[C");
    await vi.waitFor(() => expect(f.latest()).toContain("row-399"));
    expect(f.latest()).not.toContain("new background output");
    expect(request).toHaveBeenCalledTimes(1);
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("new background output"));
    expect(request).toHaveBeenCalledTimes(2);
    f.input.write("\x1b");
    await run;
  } finally {
    f.terminal.close();
    await run.catch((e) => {
      if (!(e instanceof TerminalInterrupted)) throw e;
    });
  }
});

it("keeps an old snapshot on refresh failure, distinguishes first failure, and lets the other source remain readable", async () => {
  const f = fixture();
  const request = vi
    .fn()
    .mockRejectedValueOnce(new IpcClientError("TIMEOUT", "private"))
    .mockResolvedValueOnce({ lines: ["old snapshot"] })
    .mockRejectedValueOnce(new Error("private"));
  const run = runReadingPage("logs", {
    terminal: f.terminal,
    client: { request },
    localLogs: () => ["[web] healthy"],
  });
  try {
    await vi.waitFor(() => expect(f.latest()).toContain("TIMEOUT"));
    expect(f.latest()).not.toContain("无日志");
    expect(f.latest()).not.toContain("private");
    f.input.write("\x1b[C");
    await vi.waitFor(() => expect(f.latest()).toContain("healthy"));
    f.input.write("\x1b[D");
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("old snapshot"));
    f.input.write("r");
    await vi.waitFor(() => expect(f.latest()).toContain("刷新失败，当前为上次快照"));
    expect(f.latest()).toContain("old snapshot");
    f.input.write("\x1b");
    await run;
  } finally {
    f.terminal.close();
    await run.catch((e) => {
      if (!(e instanceof TerminalInterrupted)) throw e;
    });
  }
});

it("sorts audit newest first, starts at top, scrolls and refreshes without returning to the dashboard", async () => {
  const f = fixture();
  const items = Array.from({ length: 60 }, (_, i) => ({
    id: `${i}`,
    action: `event-${i}`,
    decision: "allow",
    resourceType: "test",
    resourceId: `res-${i}`,
    createdAt: i,
    details: { token: "must-not-display" },
  }));
  const request = vi.fn(async () => ({ items }));
  const run = runReadingPage("audit", { terminal: f.terminal, client: { request } });
  try {
    await vi.waitFor(() => expect(f.latest()).toContain("event-59"));
    expect(request).toHaveBeenCalledWith("audit.tail", { limit: 200 });
    expect(f.latest()).not.toContain("must-not-display");
    f.input.write("\x1b[F");
    await vi.waitFor(() => expect(f.latest()).toContain("event-0"));
    f.input.write("r");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(f.latest()).toContain("event-0");
    expect(f.latest()).not.toContain("Larness · 控制面板");
    f.input.write("\x1b");
    await run;
  } finally {
    f.terminal.close();
    await run.catch((e) => {
      if (!(e instanceof TerminalInterrupted)) throw e;
    });
  }
});

it("discards a late read after Esc and sanitizes external control sequences", async () => {
  const f = fixture();
  let resolve: (value: unknown) => void = () => undefined;
  const request = vi.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const run = runReadingPage("logs", {
    terminal: f.terminal,
    client: { request },
    localLogs: () => ["safe\x1b]0;injected\x07中文😀"],
  });
  try {
    f.input.write("\x1b[C");
    await vi.waitFor(() => expect(f.latest()).toContain("safe中文😀"));
    expect(f.latest()).not.toContain("injected");
    f.input.write("\x1b");
    await run;
    f.terminal.render({ title: "other page", body: [], footer: "" });
    const before = f.latest();
    resolve({ lines: ["late data"] });
    await new Promise((done) => setImmediate(done));
    expect(f.latest()).toBe(before);
  } finally {
    f.terminal.close();
  }
});
