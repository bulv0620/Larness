import { PassThrough } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { input } from "@inquirer/prompts";
import { describe, expect, it, vi } from "vitest";
import { frameLines, safeText } from "../../src/tui/screen.js";
import { NavigationCancelled, TerminalSession } from "../../src/tui/terminal.js";

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
    term: "xterm-256color",
  });
  return { stdin, stdout, terminal, output: () => output };
}

describe("terminal pages", () => {
  it("renders bounded Unicode frames and removes external cursor/title sequences", () => {
    const lines = frameLines(
      {
        title: "配对",
        body: ["中文🙂".repeat(60), "\x1b[2Jhello\x1b]0;attack\x07"],
        footer: "Esc 返回",
      },
      80,
      24,
    );
    expect(lines).toHaveLength(24);
    expect(lines.join("\n")).not.toContain("\x1b");
    expect(lines.join("\n")).not.toContain("attack");
    expect(lines.at(-1)).toContain("Esc 返回");
    expect(safeText("a\r\nb\t\x00")).toBe("a\nb    ");
  });

  it("uses an alternate screen and restores input and cursor exactly once", () => {
    const f = fixture();
    f.terminal.open();
    f.terminal.render({ title: "日志", body: ["previous page"], footer: "Esc 返回" });
    f.terminal.render({ title: "概览", body: ["current page"], footer: "q 退出" });
    expect(f.stdin.isRaw).toBe(true);
    expect(f.output()).toContain("\x1b[?1049h");
    expect(f.output().split("\x1b[2J").at(-1)).not.toContain("previous page");
    f.terminal.close();
    f.terminal.close();
    expect(f.stdin.isRaw).toBe(false);
    expect(f.output().split("\x1b[?1049l").slice(1)).toHaveLength(1);
    expect(f.output()).toContain("\x1b[?25h");
  });

  it("keeps q as prompt text and resumes menu input after an Esc cancellation", async () => {
    const f = fixture();
    f.terminal.open();
    try {
      const prompt = f.terminal.prompt((context) => input({ message: "名字" }, context));
      await vi.waitFor(() => expect(f.output()).toContain("名字"));
      f.stdin.write("q\r");
      expect(await prompt).toBe("q");
      const cancelled = f.terminal.prompt((context) => input({ message: "名字" }, context));
      const check = expect(cancelled).rejects.toBeInstanceOf(NavigationCancelled);
      f.stdin.write("\x1b");
      await check;
      const key = f.terminal.nextKey();
      f.stdin.write("q");
      expect((await key).name).toBe("q");
    } finally {
      f.terminal.close();
    }
  });

  it("does not accept business keys in a small viewport but still allows Escape", async () => {
    const f = fixture();
    f.terminal.open();
    try {
      f.stdout.columns = 60;
      f.stdout.rows = 16;
      f.stdout.emit("resize");
      const key = f.terminal.nextKey();
      f.stdin.write("q");
      f.stdin.write("\x1b");
      expect((await key).name).toBe("escape");
      expect(f.output()).toContain("终端空间不足");
    } finally {
      f.terminal.close();
    }
  });
});
