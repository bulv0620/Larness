import { emitKeypressEvents } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import type { ReadStream, WriteStream } from "node:tty";
import { input } from "@inquirer/prompts";
import { z } from "zod";
import { clipLine, frameLines, type ScreenFrame } from "./screen.js";

const KeySchema = z.object({
  name: z.string().optional(),
  sequence: z.string().optional(),
  ctrl: z.boolean().optional(),
  shift: z.boolean().optional(),
});
export interface TuiKey {
  name: string;
  text: string;
  ctrl: boolean;
  shift: boolean;
}
export class NavigationCancelled extends Error {
  constructor() {
    super("返回上一级");
    this.name = "NavigationCancelled";
  }
}
export class TerminalInterrupted extends Error {
  constructor() {
    super("正在停止服务");
    this.name = "TerminalInterrupted";
  }
}
export type PromptContext = NonNullable<Parameters<typeof input>[1]>;

class PromptInput extends PassThrough {
  readonly isTTY = true;
  isRaw = true;
  setRawMode(raw: boolean): this {
    this.isRaw = raw;
    return this;
  }
}

export class TerminalSession {
  readonly input: ReadStream;
  readonly output: WriteStream;
  readonly term: string | undefined;
  onInterrupt: (() => void) | undefined;
  private opened = false;
  private stopped = false;
  private previousRaw = false;
  private keys: TuiKey[] = [];
  private inputBlocked = false;
  private frame: ScreenFrame = { title: "启动", body: [], footer: "Ctrl+C 停止服务" };
  private waiting: { resolve(key: TuiKey): void; reject(error: Error): void } | null = null;
  private promptInput: PromptInput | null = null;
  private promptAbort: AbortController | null = null;

  constructor(options: { input?: ReadStream; output?: WriteStream; term?: string } = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    // Native Windows shells do not set TERM. The console itself is a capable
    // ANSI terminal (Windows 10 1511+ conhost and Windows Terminal).
    this.term =
      options.term ??
      process.env.TERM ??
      (process.platform === "win32" ? "xterm-256color" : undefined);
  }
  get columns(): number {
    return this.output.columns || 80;
  }
  get rows(): number {
    return this.output.rows || 24;
  }
  get bodyHeight(): number {
    return Math.max(1, this.rows - 4);
  }
  get small(): boolean {
    return this.columns < 80 || this.rows < 24;
  }

  open(): void {
    if (this.opened) return;
    if (!this.input.isTTY || !this.output.isTTY || !this.term || this.term === "dumb")
      throw new Error(
        "TUI 需要交互终端（TTY，TERM 非 dumb）；请在终端运行 pnpm dev 或 node app.js",
      );
    this.previousRaw = this.input.isRaw;
    this.opened = true;
    this.input.setRawMode(true);
    emitKeypressEvents(this.input);
    this.input.on("keypress", this.onKey);
    this.output.on("resize", this.onResize);
    this.input.resume();
    this.output.write("\x1b[?1049h\x1b[?25l");
    this.paint();
  }
  render(frame: ScreenFrame): void {
    this.frame = frame;
    if (!this.promptInput) this.paint();
  }
  private paint(): void {
    if (!this.opened) return;
    const lines = frameLines(this.frame, this.columns, this.rows);
    this.output.write(`\x1b[?25l\x1b[2J\x1b[H${lines.join("\r\n")}`);
  }
  private onResize = (): void => {
    if (this.small) this.keys = [];
    if (!this.promptInput || this.small) this.paint();
  };
  private onKey = (text: unknown, raw: unknown): void => {
    const parsed = KeySchema.safeParse(raw);
    if (!parsed.success) return;
    const key = parsed.data;
    if (key.ctrl && key.name === "c") {
      this.interrupt();
      this.onInterrupt?.();
      return;
    }
    if (this.small && key.name !== "escape") return;
    if (this.promptInput) {
      if (key.name === "escape") this.promptAbort?.abort();
      else this.promptInput.write(key.sequence ?? (typeof text === "string" ? text : ""));
      return;
    }
    if (this.inputBlocked) return;
    const event = {
      name: key.name ?? "",
      text: typeof text === "string" ? text : "",
      ctrl: key.ctrl ?? false,
      shift: key.shift ?? false,
    };
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = null;
      waiting.resolve(event);
    } else if (this.keys.length < 16) this.keys.push(event);
  };
  nextKey(): Promise<TuiKey> {
    if (this.stopped) return Promise.reject(new TerminalInterrupted());
    if (this.waiting || this.promptInput)
      return Promise.reject(new Error("terminal input already owned"));
    const queued = this.keys.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }
  async prompt<T>(run: (context: PromptContext) => Promise<T>): Promise<T> {
    if (this.stopped) throw new TerminalInterrupted();
    if (this.waiting || this.promptInput) throw new Error("terminal input already owned");
    this.keys = [];
    const proxy = new PromptInput();
    const abort = new AbortController();
    // Inquirer ends its destination when a prompt settles; the terminal itself
    // must remain writable for the next page and the next prompt.
    const destination = new Writable({
      write: (chunk: Buffer, encoding, callback) => {
        this.output.write(chunk, encoding, callback);
      },
    });
    Object.defineProperty(destination, "columns", { get: () => this.columns });
    Object.defineProperty(destination, "rows", { get: () => this.rows });

    this.promptInput = proxy;
    this.promptAbort = abort;
    this.output.write(`\x1b[${this.rows - 1};1H\x1b[0J\x1b[?25h`);
    try {
      return await run({
        input: proxy,
        output: destination,
        signal: abort.signal,
        clearPromptOnDone: true,
      });
    } catch (error) {
      if (this.stopped) throw new TerminalInterrupted();
      if (abort.signal.aborted) throw new NavigationCancelled();
      throw error;
    } finally {
      proxy.destroy();
      this.promptInput = null;
      this.promptAbort = null;
      this.paint();
    }
  }
  async ask(message: string, defaultValue?: string): Promise<string> {
    return this.prompt((context) =>
      input(
        {
          message: clipLine(message, Math.floor((this.columns - 8) / 2)),
          default: defaultValue,
          transformer: (value) => clipLine(value, Math.max(1, Math.floor((this.columns - 12) / 2))),
        },
        context,
      ),
    );
  }
  notify(): void {
    const event = { name: "update", text: "", ctrl: false, shift: false };
    if (this.waiting) {
      const waiting = this.waiting;
      this.waiting = null;
      waiting.resolve(event);
    } else if (!this.keys.some((key) => key.name === "update")) this.keys.push(event);
  }

  blockInput(blocked: boolean): void {
    this.inputBlocked = blocked;
    this.keys = [];
  }

  interrupt(): void {
    this.keys = [];
    this.stopped = true;
    this.waiting?.reject(new TerminalInterrupted());
    this.waiting = null;
    this.promptAbort?.abort();
  }
  close(): void {
    if (!this.opened) return;
    this.interrupt();
    this.opened = false;
    this.input.off("keypress", this.onKey);
    this.output.off("resize", this.onResize);
    try {
      this.input.setRawMode(this.previousRaw);
    } finally {
      this.input.pause();
      this.output.write("\x1b[0m\x1b[?25h\x1b[?1049l");
      this.frame = { title: "", body: [], footer: "" };
    }
  }
}
