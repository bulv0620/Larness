import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPm2Experiment,
  type GlobalPm2,
  inspectGlobalPm2,
  type Pm2Experiment,
  setupGlobalPm2,
} from "../../scripts/m4-poc/pm2.js";
import { runManagedSessions } from "../../src/tui/lifecycle.js";
import { startManagedRuntime } from "../../src/tui/supervisor.js";
import { getFreePort } from "../helpers.js";

const exec = promisify(execFile);
const marker = "M4_POC_SYNTHETIC_MARKER";

async function readHealth(port: number) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(500),
  });
  return { status: response.status, body: await response.json() };
}

describe.skipIf(process.env.LARNESS_POC_PM2 !== "1")("M4-0 with actual global npm and PM2", () => {
  let root: string;
  let npm: string;
  let prefix: string;
  let installed: GlobalPm2;
  let first: Pm2Experiment;
  let second: Pm2Experiment;
  let firstPort: number;
  let secondPort: number;

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "l4-")));
    npm = (await exec("/usr/bin/which", ["npm"])).stdout.trim();
    prefix = path.join(root, "global");
  });

  afterAll(async () => {
    if (!root) return;
    const results = await Promise.allSettled([first?.close(), second?.close()]);
    for (const result of results) if (result.status === "rejected") throw result.reason;
    for (const port of [firstPort, secondPort]) {
      if (port) await expect(readHealth(port)).rejects.toThrow();
    }
    if (secondPort && existsSync(path.join(second.home, "pm2.log"))) {
      const dump = await readFile(path.join(second.home, "dump.pm2"), "utf8");
      expect(dump).not.toContain(marker);
    }
    await rm(root, { recursive: true, force: true });
    expect(existsSync(root)).toBe(false);
  });

  it("P1 installs globally into the test prefix, reuses it and checks failure paths", async () => {
    const options = { root, npm, prefix };
    await expect(inspectGlobalPm2(options)).resolves.toEqual({ status: "missing" });
    await expect(setupGlobalPm2({ ...options, npm: path.join(root, "no-npm") })).resolves.toEqual({
      status: "unavailable",
      reason: "npm",
    });

    await mkdir(prefix, { mode: 0o500 });
    try {
      await expect(setupGlobalPm2(options)).resolves.toEqual({
        status: "unavailable",
        reason: "permissions",
      });
    } finally {
      await chmod(prefix, 0o700);
    }

    const closedPort = await getFreePort();
    await expect(
      setupGlobalPm2({ ...options, registry: `http://127.0.0.1:${closedPort}` }),
    ).resolves.toEqual({ status: "unavailable", reason: "install" });
    await expect(inspectGlobalPm2(options)).resolves.toEqual({ status: "missing" });

    const result = await setupGlobalPm2(options);
    expect(result).toMatchObject({ status: "ready", version: "7.1.2", installed: true });
    if (result.status !== "ready") throw new Error("global npm installation failed");
    installed = result;
    const before = await lstat(installed.entry);
    await expect(setupGlobalPm2(options)).resolves.toMatchObject({
      status: "ready",
      installed: false,
    });
    expect((await lstat(installed.entry)).mtimeMs).toBe(before.mtimeMs);
    expect(existsSync(path.join(root, "home", ".pm2"))).toBe(false);

    const manifest = path.join(path.dirname(path.dirname(installed.entry)), "package.json");
    const original = await readFile(manifest, "utf8");
    try {
      await writeFile(manifest, JSON.stringify({ ...JSON.parse(original), version: "0.0.0" }));
      await expect(setupGlobalPm2(options)).resolves.toEqual({
        status: "unavailable",
        reason: "version",
      });
    } finally {
      await writeFile(manifest, original);
    }
    const escaped = path.join(root, "escaped");
    await writeFile(escaped, "");
    const saved = `${installed.entry}.backup`;
    await rename(installed.entry, saved);
    try {
      await symlink(escaped, installed.entry);
      await expect(inspectGlobalPm2(options)).resolves.toEqual({
        status: "unavailable",
        reason: "identity",
      });
    } finally {
      await rm(installed.entry, { force: true });
      await rename(saved, installed.entry);
    }
  }, 90_000);

  it("P2 separates two same-name services, operations and logs", async () => {
    first = await createPm2Experiment(root, installed, "one");
    second = await createPm2Experiment(root, installed, "two");
    await expect(first.observe()).resolves.toEqual({ status: "unknown" });
    expect(existsSync(path.join(first.home, "rpc.sock"))).toBe(false);
    firstPort = await getFreePort();
    await first.register({ port: firstPort, version: "v1" });

    await expect(second.stop()).resolves.toBe(false);
    secondPort = await getFreePort();
    await second.register({ port: secondPort, version: "v2" });
    expect(await first.start()).toBe(true);
    await symlink(first.home, second.home);
    try {
      await expect(second.observe()).resolves.toEqual({ status: "unknown" });
      await expect(second.start()).resolves.toBe(false);
      await expect(second.stop()).resolves.toBe(false);
    } finally {
      await rm(second.home);
    }
    vi.stubEnv("LARNESS_M4_TEST_SECRET", marker);
    try {
      expect(await second.start()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
    await expect.poll(() => first.observe()).toMatchObject({ status: "healthy", version: "v1" });
    await expect.poll(() => second.observe()).toMatchObject({ status: "healthy", version: "v2" });
    expect(await first.logs()).toContain("ready v1");
    expect(await first.logs()).not.toContain("ready v2");
    expect(await second.logs()).toContain("ready v2");
    const other = await second.observe();
    const record = path.join(root, "app-two", "registered.json");
    const original = await readFile(record, "utf8");
    try {
      await writeFile(record, JSON.stringify({ port: secondPort, version: "v3" }));
      expect(await second.observe()).toEqual({ status: "unknown" });
      expect(await second.stop()).toBe(false);
    } finally {
      await writeFile(record, original);
    }
    expect(await first.stop()).toBe(true);
    await expect(first.observe()).resolves.toMatchObject({ status: "stopped" });
    expect(await second.observe()).toEqual(other);
  }, 25_000);

  it("P3 preserves PID and health on TUI exit and Server kill and reconciles on reopen", async () => {
    const before = await second.observe();
    expect(before).toMatchObject({ status: "healthy", version: "v2" });
    const httpBefore = await readHealth(secondPort);
    const managedPort = await getFreePort();
    const managedDir = path.join(root, "larness");
    vi.stubEnv("LARNESS_DATA_DIR", managedDir);
    vi.stubEnv("LARNESS_PORT", String(managedPort));
    vi.stubEnv("LARNESS_HOST", "127.0.0.1");
    const start = () => startManagedRuntime({ dev: true, out: () => undefined });
    const attach = async (crash: boolean) => {
      await runManagedSessions({
        start,
        onRuntime: () => undefined,
        attach: async (runtime) => {
          const reopened = await createPm2Experiment(root, installed, "two");
          expect(await reopened.observe()).toEqual(before);
          if (crash) {
            const result = await exec("/usr/sbin/lsof", [
              "-n",
              "-P",
              "-t",
              `-iTCP:${managedPort}`,
              "-sTCP:LISTEN",
            ]);
            const serverPid = Number(result.stdout.trim());
            expect(serverPid).toBeGreaterThan(1);
            const { stdout } = await exec("/bin/ps", [
              "-ww",
              "-p",
              String(serverPid),
              "-o",
              "command=",
            ]);
            expect(stdout).toContain("src/index.ts --managed-dev-web");
            process.kill(serverPid, "SIGKILL");
            await runtime.serverExited;
            expect(await readHealth(secondPort)).toEqual(httpBefore);
          }
          return "done";
        },
      });
      if (!crash) {
        expect(existsSync(path.join(managedDir, "ipc", "token"))).toBe(false);
        expect(existsSync(path.join(managedDir, "larness.lock"))).toBe(false);
      }
      await expect(fetch(`http://127.0.0.1:${managedPort}/api/health`)).rejects.toThrow();
      expect(await readHealth(secondPort)).toEqual(httpBefore);
    };
    try {
      await attach(false);
      await attach(true);
      await attach(false);
    } finally {
      vi.unstubAllEnvs();
    }
  }, 60_000);

  it("P4 keeps unverified, failed and stopped states distinct without duplicate starts", async () => {
    const occupied = createServer((_request, response) => response.end("unrelated"));
    await new Promise<void>((resolve, reject) => {
      occupied.once("error", reject);
      occupied.listen(firstPort, "127.0.0.1", resolve);
    });
    try {
      expect(await first.start()).toBe(false);
      await expect(first.observe()).resolves.toMatchObject({ status: "stopped" });
    } finally {
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
    expect(await first.start()).toBe(true);
    await expect.poll(() => first.observe()).toMatchObject({ status: "healthy", version: "v1" });
    const running = await first.observe();
    if (running.status !== "healthy") throw new Error("expected a healthy process");
    const slow = path.join(root, "app-one", "slow-health");
    await writeFile(slow, "");
    try {
      await expect(first.observe()).resolves.toEqual({ ...running, status: "unhealthy" });
      expect(await first.start()).toBe(true);
    } finally {
      await rm(slow);
    }
    expect(await first.observe()).toEqual(running);
    process.kill(running.pid, "SIGKILL");
    await expect.poll(() => first.observe()).toMatchObject({ status: "failed" });
    await first.close();
    await expect(first.observe()).resolves.toEqual({ status: "unknown" });
    expect(existsSync(path.join(first.home, "rpc.sock"))).toBe(false);
    await symlink(path.join(second.home, "rpc.sock"), path.join(first.home, "rpc.sock"));
    await expect(first.observe()).resolves.toEqual({ status: "unknown" });
    await expect(first.start()).resolves.toBe(false);
  }, 20_000);

  it("P5 keeps runtime private and excludes inherited secret-like values", async () => {
    expect((await lstat(second.home)).mode & 0o777).toBe(0o700);
    expect(await second.observe()).toMatchObject({ status: "healthy" });
    const info = await readHealth(secondPort);
    expect(info.body).toMatchObject({ secretInherited: false });
    expect(await second.logs()).not.toContain(marker);
    expect(await readFile(path.join(second.home, "pm2.log"), "utf8")).not.toContain(marker);
    expect(existsSync(path.join(second.home, "dump.pm2"))).toBe(false);
  });
});
