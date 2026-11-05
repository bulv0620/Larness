import { type ChildProcess, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import path from "node:path";
import { spawn as spawnPty } from "node-pty";
import { describe, expect, it } from "vitest";
import {
  bindExecution,
  IdentityError,
  listeningSockets,
  processSnapshot,
  verifyExecution,
} from "../../scripts/m3-poc/identity.js";
import { withTempDir } from "../helpers.js";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitFor(
  check: () => Promise<boolean>,
  label: string,
  timeoutMs = 8000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function serverSource(port: number, host = "127.0.0.1"): string {
  return [
    'import { createServer } from "node:http";',
    'const server = createServer((request, response) => response.end("poc"));',
    `server.listen(${port}, ${JSON.stringify(host)}, () => console.log("POC_READY"));`,
    "",
  ].join("\n");
}

function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return { ...env, TERM: "xterm-256color" };
}

function startIntruder(port: number): ChildProcess {
  return spawn(
    process.execPath,
    [
      "-e",
      `require("node:http").createServer((request, response) => response.end("intruder")).listen(${port}, "127.0.0.1")`,
    ],
    { stdio: "ignore" },
  );
}

function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // The process already exited; nothing to clean up.
  }
}

function httpGet(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: "/" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => {
        body += chunk;
      });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

async function failureOf(run: Promise<void>): Promise<unknown> {
  return run.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe.skipIf(process.platform !== "darwin")("M3-0 execution identity PoC", () => {
  it("binds a real PTY listener, keeps the shell after Ctrl+C and rebinds on restart", async () => {
    await withTempDir(async (dir) => {
      const port = await freePort();
      await writeFile(path.join(dir, "server.mjs"), serverSource(port));
      const pty = spawnPty("/bin/sh", ["-i"], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: dir,
        env: ptyEnv(),
      });
      const output = { text: "" };
      pty.onData((data) => {
        output.text += data;
      });
      const owned: number[] = [];
      try {
        pty.write(`"${process.execPath}" server.mjs\n`);
        await waitFor(async () => output.text.includes("POC_READY"), "first listener");
        const first = await bindExecution({
          terminalId: "terminal-poc",
          leaderPid: pty.pid,
          port,
          generation: 1,
        });
        owned.push(first.pid);
        const leader = (await processSnapshot()).find((item) => item.pid === pty.pid);
        expect(leader).toBeDefined();
        expect(first.leaderPid).toBe(pty.pid);
        expect(first.session).toBe(leader?.session);
        expect(first.pid).not.toBe(pty.pid);
        expect(first.birth.length).toBeGreaterThan(0);
        await expect(verifyExecution(first)).resolves.toBeUndefined();

        pty.write("\u0003");
        await waitFor(async () => (await listeningSockets(port)).length === 0, "listener exit");
        await expect(verifyExecution(first)).rejects.toMatchObject({ reason: "LISTENER_GONE" });

        pty.write("printf 'ALIVE-%s\\n' ok\n");
        await waitFor(async () => output.text.includes("ALIVE-ok"), "surviving shell");
        expect((await processSnapshot()).some((item) => item.pid === pty.pid)).toBe(true);

        const readyBefore = occurrences(output.text, "POC_READY");
        pty.write(`"${process.execPath}" server.mjs\n`);
        await waitFor(
          async () => occurrences(output.text, "POC_READY") > readyBefore,
          "second listener",
        );
        const second = await bindExecution({
          terminalId: "terminal-poc",
          leaderPid: pty.pid,
          port,
          generation: 2,
        });
        owned.push(second.pid);
        expect(second.executionId).not.toBe(first.executionId);
        expect(second.birth).not.toBe(first.birth);
        await expect(verifyExecution(second)).resolves.toBeUndefined();

        const stale = await failureOf(verifyExecution(first));
        expect(stale).toBeInstanceOf(IdentityError);
        expect(["LISTENER_REPLACED", "LISTENER_IDENTITY_CHANGED"]).toContain(
          (stale as IdentityError).reason,
        );
      } finally {
        pty.kill();
        await delay(200);
        for (const socket of await listeningSockets(port)) killQuietly(socket.pid);
        for (const pid of owned) killQuietly(pid);
      }
    });
  }, 30_000);

  it("rejects a reused port owned outside the terminal and exposes the check-to-connect window", async () => {
    await withTempDir(async (dir) => {
      const port = await freePort();
      await writeFile(path.join(dir, "server.mjs"), serverSource(port));
      const pty = spawnPty("/bin/sh", ["-i"], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: dir,
        env: ptyEnv(),
      });
      const output = { text: "" };
      pty.onData((data) => {
        output.text += data;
      });
      let intruder: ChildProcess | undefined;
      const owned: number[] = [];
      try {
        pty.write(`"${process.execPath}" server.mjs\n`);
        await waitFor(async () => output.text.includes("POC_READY"), "first listener");
        const first = await bindExecution({
          terminalId: "terminal-poc",
          leaderPid: pty.pid,
          port,
          generation: 1,
        });
        owned.push(first.pid);

        pty.write("\u0003");
        await waitFor(async () => (await listeningSockets(port)).length === 0, "listener exit");
        intruder = startIntruder(port);
        await waitFor(async () => (await listeningSockets(port)).length > 0, "intruder listener");

        await expect(verifyExecution(first)).rejects.toMatchObject({ reason: "LISTENER_REPLACED" });
        await expect(
          bindExecution({
            terminalId: "terminal-poc",
            leaderPid: pty.pid,
            port,
            generation: 3,
          }),
        ).rejects.toMatchObject({ reason: "LISTENER_NOT_IN_TERMINAL_TREE" });

        await stopChild(intruder);
        intruder = undefined;
        await waitFor(async () => (await listeningSockets(port)).length === 0, "port released");

        const readyBefore = occurrences(output.text, "POC_READY");
        pty.write(`"${process.execPath}" server.mjs\n`);
        await waitFor(
          async () => occurrences(output.text, "POC_READY") > readyBefore,
          "rebound listener",
        );
        const bound = await bindExecution({
          terminalId: "terminal-poc",
          leaderPid: pty.pid,
          port,
          generation: 4,
        });
        owned.push(bound.pid);
        await verifyExecution(bound);

        // Deliberately widen the gap between the last identity check and connect.
        pty.write("\u0003");
        await waitFor(async () => (await listeningSockets(port)).length === 0, "listener exit");
        intruder = startIntruder(port);
        await waitFor(
          async () => (await listeningSockets(port)).length > 0,
          "replacement listener",
        );
        expect(await httpGet(port)).toBe("intruder");
        await expect(verifyExecution(bound)).rejects.toMatchObject({ reason: "LISTENER_REPLACED" });
      } finally {
        pty.kill();
        if (intruder) await stopChild(intruder);
        await delay(200);
        for (const socket of await listeningSockets(port)) killQuietly(socket.pid);
        for (const pid of owned) killQuietly(pid);
      }
    });
  }, 30_000);

  it("refuses a wildcard listener even when it belongs to the terminal session", async () => {
    await withTempDir(async (dir) => {
      const port = await freePort();
      await writeFile(path.join(dir, "server.mjs"), serverSource(port, "0.0.0.0"));
      const pty = spawnPty("/bin/sh", ["-i"], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: dir,
        env: ptyEnv(),
      });
      const output = { text: "" };
      pty.onData((data) => {
        output.text += data;
      });
      const owned: number[] = [];
      try {
        pty.write(`"${process.execPath}" server.mjs\n`);
        await waitFor(async () => output.text.includes("POC_READY"), "wildcard listener");
        const sockets = await listeningSockets(port);
        expect(sockets.length).toBeGreaterThan(0);
        expect(sockets.some((socket) => socket.wildcard)).toBe(true);
        await expect(
          bindExecution({ terminalId: "terminal-poc", leaderPid: pty.pid, port, generation: 1 }),
        ).rejects.toMatchObject({ reason: "LISTENER_NOT_LOOPBACK" });
        const snapshot = await processSnapshot();
        const socketPid = sockets[0].pid;
        const ownedListener = snapshot.find((item) => item.pid === socketPid);
        expect(ownedListener?.session).toBe(snapshot.find((item) => item.pid === pty.pid)?.session);
        owned.push(socketPid);
      } finally {
        pty.kill();
        await delay(200);
        for (const socket of await listeningSockets(port)) killQuietly(socket.pid);
        for (const pid of owned) killQuietly(pid);
      }
    });
  }, 30_000);
});
