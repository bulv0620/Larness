import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inspectInstanceLock, isProcessAlive, lockFilePath } from "../../src/bootstrap/lock.js";
import { startServer } from "../../src/bootstrap/start.js";
import {
  type LifecycleIo,
  restartCommand,
  startCommand,
  stopCommand,
  tuiCommand,
} from "../../src/cli/lifecycle.js";
import { ipcTokenPath } from "../../src/ipc/address.js";
import { createLogSink, getFreePort, withTempDir } from "../helpers.js";

const fixture = fileURLToPath(new URL("../fixtures/daemon-server.mjs", import.meta.url));

function makeIo(env: NodeJS.ProcessEnv) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: LifecycleIo = {
    env,
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
  };
  return { io, stdout: () => stdout.join(""), stderr: () => stderr.join("") };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function stopFixture(dataDir: string): Promise<void> {
  const lock = await inspectInstanceLock(dataDir);
  const pid = lock?.record?.pid;
  if (pid !== undefined && isProcessAlive(pid)) {
    process.kill(pid, "SIGTERM");
    await waitFor(async () => !isProcessAlive(pid));
  }
}

async function prepareRoot(dir: string): Promise<{ root: string; webDist: string }> {
  const root = path.join(dir, "server-root");
  const webDist = path.join(dir, "web-dist");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await mkdir(webDist, { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"type":"module"}\n');
  await writeFile(path.join(root, "dist", "index.js"), await readFile(fixture, "utf8"));
  await writeFile(path.join(webDist, "index.html"), "<html></html>");
  return { root, webDist };
}

describe("start command", () => {
  const running: string[] = [];

  afterEach(async () => {
    for (const dir of running.splice(0)) await stopFixture(dir);
  });

  it("spawns a detached server and becomes idempotent", async () => {
    await withTempDir(async (dir) => {
      const { root, webDist } = await prepareRoot(dir);
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: path.join(dir, "data"), LARNESS_PORT: String(port) };
      const io = makeIo(env);

      const first = await startCommand(io.io, { root, webDist, readyTimeoutMs: 5_000 });
      expect(first).toBe(0);
      expect(io.stdout()).toContain("server started");
      expect(io.stdout()).toContain("daemon.log");

      const lock = await inspectInstanceLock(env.LARNESS_DATA_DIR);
      expect(lock?.alive).toBe(true);
      expect(lock?.record).toMatchObject({ mode: "background" });
      running.push(env.LARNESS_DATA_DIR);

      const secondIo = makeIo(env);
      const second = await startCommand(secondIo.io, { root, webDist, readyTimeoutMs: 5_000 });
      expect(second).toBe(0);
      expect(secondIo.stdout()).toContain("already running");
    });
  });

  it("refuses to start without a built server", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const io = makeIo({
        LARNESS_DATA_DIR: path.join(dir, "data"),
        LARNESS_PORT: String(port),
      });
      expect(await startCommand(io.io, { root: path.join(dir, "empty") })).toBe(1);
      expect(io.stderr()).toContain("pnpm build");
    });
  });
});

describe("stop command", () => {
  it("stops a real server over IPC and releases the lock", async () => {
    await withTempDir(async (dir) => {
      const port = await getFreePort();
      const env = { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port) };
      const server = await startServer({ env, logDestination: createLogSink().stream });

      try {
        const io = makeIo(env);
        expect(await stopCommand(io.io)).toBe(0);
        expect(io.stdout()).toContain("management server stopped");
        expect(io.stdout()).toContain("PM2 services");
        expect(await inspectInstanceLock(dir)).toBeNull();
        await expect(readFile(ipcTokenPath(dir), "utf8")).rejects.toThrow();
      } finally {
        await server.shutdown("test").catch(() => undefined);
      }
    });
  });

  it("is idempotent when nothing is running", async () => {
    await withTempDir(async (dir) => {
      const io = makeIo({ LARNESS_DATA_DIR: dir });
      expect(await stopCommand(io.io)).toBe(0);
      expect(io.stdout()).toContain("not running");
    });
  });

  it("treats a stale lock as not running", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        lockFilePath(dir),
        `${JSON.stringify({ pid: 2_147_483_647, startedAt: 1, version: "dead" })}\n`,
        { mode: 0o600 },
      );
      const io = makeIo({ LARNESS_DATA_DIR: dir });
      expect(await stopCommand(io.io)).toBe(0);
      expect(io.stdout()).toContain("stale lock");
    });
  });

  it("refuses to guess when IPC is unreachable and leaves the lock", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        lockFilePath(dir),
        `${JSON.stringify({ pid: process.pid, startedAt: Date.now(), version: "test" })}\n`,
        { mode: 0o600 },
      );
      const io = makeIo({ LARNESS_DATA_DIR: dir });
      expect(await stopCommand(io.io)).toBe(1);
      expect(io.stderr()).toContain("IPC endpoint is unreachable");
      expect(await inspectInstanceLock(dir)).not.toBeNull();
    });
  });
});

describe("restart and tui guards", () => {
  it("refuses to restart a foreground dev instance", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        lockFilePath(dir),
        `${JSON.stringify({
          pid: process.pid,
          startedAt: Date.now(),
          version: "test",
          mode: "foreground",
          dev: true,
        })}\n`,
        { mode: 0o600 },
      );
      const io = makeIo({ LARNESS_DATA_DIR: dir });
      expect(await restartCommand(io.io)).toBe(1);
      expect(io.stderr()).toContain("pnpm dev");
    });
  });

  it("requires a TTY for the TUI", async () => {
    const io = makeIo({});
    expect(await tuiCommand(io.io)).toBe(1);
    expect(io.stderr()).toContain("interactive terminal");
  });
});
