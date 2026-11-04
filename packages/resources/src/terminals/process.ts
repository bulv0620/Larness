import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { OutputRedactor } from "../commands/redactor.js";
import { commandEnvironment } from "../commands/runner.js";

const exec = promisify(execFile);
interface Member {
  pid: number;
  ppid: number;
  pgid: number;
  session: string;
  birth: string;
}
async function snapshot(): Promise<Member[]> {
  const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid=,pgid=,sess=,stat=,lstart="], {
    timeout: 2000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...commandEnvironment(), LC_ALL: "C" },
  });
  return stdout.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 10 || fields[4].startsWith("Z")) return [];
    return [
      {
        pid: Number(fields[0]),
        ppid: Number(fields[1]),
        pgid: Number(fields[2]),
        session: fields[3],
        birth: fields.slice(5).join(" "),
      },
    ];
  });
}
export interface NativePty {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): { dispose(): void };
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export class ManagedPty {
  readonly ready: Promise<void>;
  readonly done: Promise<{ exitCode: number | null; stopped: boolean }>;
  readonly #owned = new Map<number, string>();
  #session: string | undefined;
  #exited = false;
  #controlAvailable = true;
  #exitCode: number | null = null;
  #stop: Promise<boolean> | undefined;
  readonly #redactor: OutputRedactor;
  readonly #timer: ReturnType<typeof setInterval>;
  #poll: Promise<void> | undefined;
  #resolve!: (value: { exitCode: number | null; stopped: boolean }) => void;
  constructor(
    readonly native: NativePty,
    secrets: string[],
    readonly output: (data: string) => void,
  ) {
    this.#redactor = new OutputRedactor(secrets);
    this.done = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    this.ready = this.#capture();
    this.#timer = setInterval(() => {
      if (!this.#poll) {
        this.#poll = this.#capture()
          .catch(() => {
            this.#controlAvailable = false;
            void this.stop();
          })
          .finally(() => {
            this.#poll = undefined;
          });
      }
    }, 250);
    this.#timer.unref();
    native.onData((data) => {
      try {
        this.#emit(this.#redactor.push(data));
      } catch {
        void this.stop();
      }
    });
    native.onExit((event) => {
      this.#exited = true;
      this.#exitCode = event.exitCode;
      void this.stop();
    });
  }
  #emit(text: string) {
    let buffer = Buffer.from(text);
    while (buffer.length) {
      let length = Math.min(buffer.length, 16384);
      while (length < buffer.length && (buffer[length] & 0xc0) === 0x80) length--;
      this.output(buffer.subarray(0, length).toString("utf8"));
      buffer = buffer.subarray(length);
    }
  }
  async #capture() {
    this.#remember(await snapshot());
  }
  #remember(members: Member[]) {
    const leader = members.find((member) => member.pid === this.native.pid);
    if (
      leader &&
      !this.#exited &&
      (!this.#owned.has(leader.pid) || this.#owned.get(leader.pid) === leader.birth)
    ) {
      this.#session ??= leader.session;
      this.#owned.set(leader.pid, leader.birth);
      // PTY foreground jobs have their own process groups within this session.
      const included = new Set([leader.pid]);
      for (let round = 0; round < members.length; round++) {
        let added = false;
        for (const member of members) {
          if (
            !included.has(member.pid) &&
            (included.has(member.ppid) ||
              (this.#session !== "0" && member.session === this.#session))
          ) {
            included.add(member.pid);
            added = true;
          }
        }
        if (!added) break;
      }
      for (const member of members)
        if (included.has(member.pid)) this.#owned.set(member.pid, member.birth);
    }
  }
  async #signal(signal: NodeJS.Signals) {
    await this.#capture();
    const members = await snapshot();
    this.#remember(members);
    const candidates = members.filter((member) => this.#owned.get(member.pid) === member.birth);
    const related = members.filter(
      (member) =>
        member.pid === this.native.pid ||
        member.pgid === this.native.pid ||
        (this.#session && this.#session !== "0" && member.session === this.#session),
    );
    if (!candidates.length) return related.length === 0;
    const groups = [...new Set(candidates.map((member) => member.pgid))].sort(
      (a, b) => Number(a === this.native.pid) - Number(b === this.native.pid),
    );
    for (const group of groups) {
      const latest = await snapshot();
      // Account for children forked since the previous snapshot before validating the group.
      this.#remember(latest);
      const current = latest.filter((member) => member.pgid === group);
      if (!current.length) continue;
      if (!current.every((member) => this.#owned.get(member.pid) === member.birth)) return false;
      try {
        process.kill(-group, signal);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return false;
      }
    }
    return true;
  }
  async #gone() {
    const members = await snapshot();
    return !members.some(
      (member) =>
        this.#owned.get(member.pid) === member.birth ||
        member.pid === this.native.pid ||
        member.pgid === this.native.pid ||
        (this.#session && this.#session !== "0" && member.session === this.#session),
    );
  }
  get exited() {
    return this.#exited;
  }
  get controlAvailable() {
    return this.#controlAvailable && !this.#exited && !this.#stop;
  }
  stop(): Promise<boolean> {
    this.#stop ??= (async () => {
      let stopped = false;
      try {
        await this.ready;
        if (!(await this.#gone())) {
          if (!(await this.#signal("SIGTERM"))) return false;
          await delay(300);
          if (!(await this.#gone()) && !(await this.#signal("SIGKILL"))) return false;
        }
        const deadline = Date.now() + 2000;
        do {
          if (this.#exited && (await this.#gone())) {
            stopped = true;
            break;
          }
          await delay(20);
        } while (Date.now() < deadline);
        return stopped;
      } catch {
        return false;
      } finally {
        clearInterval(this.#timer);
        try {
          this.#emit(this.#redactor.push("", true));
        } catch {
          stopped = false;
        }
        this.#resolve({ exitCode: this.#exitCode, stopped });
      }
    })();
    return this.#stop;
  }
}
