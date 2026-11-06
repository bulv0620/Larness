import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const version = "7.1.2";
const serviceName = "m4-poc-service";

export type GlobalPm2 = { status: "ready"; entry: string; version: string; installed: boolean };
type Unavailable = {
  status: "unavailable";
  reason: "npm" | "identity" | "version" | "permissions" | "install";
};
type GlobalOptions = { root: string; npm: string; prefix: string; registry?: string };
type GlobalStatus = GlobalPm2 | Unavailable | { status: "missing" };
const manifestSchema = z.object({ name: z.literal("pm2"), version: z.string() });

function absent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function fileInfo(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}

async function privateRoot(root: string): Promise<boolean> {
  const info = await fileInfo(root);
  return (
    path.dirname(root) === (await realpath(tmpdir())) &&
    /^l4-[a-zA-Z0-9]+$/.test(path.basename(root)) &&
    info?.isDirectory() === true &&
    info.uid === process.getuid?.() &&
    (info.mode & 0o077) === 0
  );
}

function childEnv(root: string, npm?: string): NodeJS.ProcessEnv {
  const bin = [path.dirname(process.execPath), "/usr/bin", "/bin"];
  if (npm) bin.splice(1, 0, path.dirname(npm));
  return { HOME: path.join(root, "home"), PATH: bin.join(path.delimiter), LANG: "C" };
}

async function runNpm(options: GlobalOptions, args: string[], timeout = 5_000) {
  return exec(
    options.npm,
    [
      ...args,
      "--global",
      "--prefix",
      options.prefix,
      "--userconfig",
      path.join(options.root, "user.npmrc"),
      "--globalconfig",
      path.join(options.root, "global.npmrc"),
      "--cache",
      path.join(options.root, "npm-cache"),
    ],
    { cwd: options.root, env: childEnv(options.root, options.npm), timeout },
  );
}

export async function inspectGlobalPm2(options: GlobalOptions): Promise<GlobalStatus> {
  if (!(await privateRoot(options.root)) || options.prefix !== path.join(options.root, "global"))
    return { status: "unavailable", reason: "identity" };
  const prefix = await fileInfo(options.prefix);
  if (prefix && (!prefix.isDirectory() || (await realpath(options.prefix)) !== options.prefix))
    return { status: "unavailable", reason: "identity" };

  let modules: string;
  try {
    if (!path.isAbsolute(options.npm)) return { status: "unavailable", reason: "npm" };
    modules = (await runNpm(options, ["root"])).stdout.trim();
  } catch {
    return { status: "unavailable", reason: "npm" };
  }
  if (modules !== path.join(options.prefix, "lib", "node_modules"))
    return { status: "unavailable", reason: "identity" };

  const pkg = path.join(modules, "pm2");
  try {
    const info = await fileInfo(pkg);
    if (!info) return { status: "missing" };
    const entry = path.join(pkg, "bin", "pm2");
    const manifest = path.join(pkg, "package.json");
    if (
      !info.isDirectory() ||
      (await realpath(pkg)) !== pkg ||
      (await realpath(entry)) !== entry ||
      (await realpath(manifest)) !== manifest ||
      !(await lstat(entry)).isFile() ||
      !(await lstat(manifest)).isFile()
    )
      return { status: "unavailable", reason: "identity" };
    const parsed = manifestSchema.parse(JSON.parse(await readFile(manifest, "utf8")));
    if (parsed.version !== version) return { status: "unavailable", reason: "version" };
    return { status: "ready", entry, version, installed: false };
  } catch {
    return { status: "unavailable", reason: "identity" };
  }
}

export async function setupGlobalPm2(options: GlobalOptions): Promise<GlobalPm2 | Unavailable> {
  const current = await inspectGlobalPm2(options);
  if (current.status !== "missing") return current;
  try {
    await mkdir(options.prefix, { recursive: true, mode: 0o700 });
    await access(options.prefix, constants.W_OK);
  } catch {
    return { status: "unavailable", reason: "permissions" };
  }
  try {
    await runNpm(
      options,
      [
        "install",
        `pm2@${version}`,
        "--ignore-scripts",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--fetch-retries=0",
        "--registry",
        options.registry ?? "https://registry.npmjs.org",
      ],
      65_000,
    );
  } catch {
    return { status: "unavailable", reason: "install" };
  }
  const installed = await inspectGlobalPm2(options);
  return installed.status === "ready"
    ? { ...installed, installed: true }
    : { status: "unavailable", reason: "install" };
}

// PM2's public connect/list can start a daemon. This isolated probe uses the pinned
// client's socket-only connection and emits only the fields needed for identity.
const rpcProbe = `
const Client = require(process.argv[1]);
const method = process.argv[2];
const client = new Client();
client.launchRPC((error) => {
  if (error) return process.exit(1);
  client.executeRemote(method, JSON.parse(process.argv[3]), (failure, result) => {
    if (failure || result?.error) return process.exit(1);
    const value = method === "getMonitorData" ? result.map(({pid, pm2_env: app}) => ({
      pid, id: app.pm_id, status: app.status, name: app.name, namespace: app.namespace,
      entry: app.pm_exec_path, cwd: app.pm_cwd, args: app.args,
      log: app.pm_out_log_path, interpreter: app.exec_interpreter
    })) : true;
    process.stdout.write(JSON.stringify(value), () => process.exit(0));
  });
});
`;

const recordSchema = z.object({
  port: z.int().min(1).max(65_535),
  version: z.string().regex(/^v[1-9][0-9]*$/),
});
type Registration = z.infer<typeof recordSchema>;

const processSchema = z.object({
  pid: z.int().nonnegative().optional(),
  id: z.int().nonnegative(),
  status: z.string(),
  name: z.string(),
  namespace: z.string().optional(),
  entry: z.string(),
  cwd: z.string(),
  args: z.array(z.string()).optional(),
  log: z.string(),
  interpreter: z.string(),
});
type Pm2Process = z.infer<typeof processSchema>;

const healthSchema = z.object({ pid: z.int().positive(), version: z.string() });
type Observed =
  | { status: "unknown" | "missing" | "stopped" | "failed" }
  | { status: "healthy" | "unhealthy"; pid: number; version: string };

export interface Pm2Experiment {
  home: string;
  register(registration: Registration): Promise<void>;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
  observe(): Promise<Observed>;
  logs(): Promise<string>;
  close(): Promise<void>;
}

const fixture = `
const { createServer } = require("node:http");
const { existsSync } = require("node:fs");
const [port, version] = process.argv.slice(2);
createServer((_request, response) => {
  if (existsSync("slow-health")) return;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({
    pid: process.pid, version, secretInherited: "LARNESS_M4_TEST_SECRET" in process.env
  }));
}).listen(Number(port), "127.0.0.1", () => console.log("ready " + version));
`;

async function portAvailable(port: number): Promise<boolean> {
  const probe = createServer();
  return new Promise((resolve) => {
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close((error) => resolve(!error)));
  });
}

export async function createPm2Experiment(
  root: string,
  pm2: GlobalPm2,
  namespace: string,
): Promise<Pm2Experiment> {
  if (
    !(await privateRoot(root)) ||
    !/^[a-z0-9-]{1,12}$/.test(namespace) ||
    pm2.entry !== path.join(root, "global", "lib", "node_modules", "pm2", "bin", "pm2") ||
    pm2.version !== version ||
    (await realpath(pm2.entry)) !== pm2.entry
  )
    throw new Error("Unverified PM2 experiment");
  const home = path.join(root, namespace);
  const work = path.join(root, `app-${namespace}`);
  const entry = path.join(work, "fixture.cjs");
  const log = path.join(home, "fixture.log");
  const record = path.join(work, "registered.json");
  const wantedRunning = path.join(work, "want-running");
  const config = path.join(work, "ecosystem.config.cjs");
  const env = {
    ...childEnv(root),
    PM2_HOME: home,
    PM2_DISABLE_MODULES: "true",
    PM2_NO_INTERACTION: "true",
  };

  async function isDaemon(pid: number): Promise<boolean> {
    try {
      const { stdout } = await exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], {
        timeout: 1_000,
      });
      return stdout.trim() === `PM2 v${version}: God Daemon (${home})`;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 1) return false;
      throw error;
    }
  }

  async function daemonPid(): Promise<number | undefined> {
    try {
      const [dir, socket, pidFile] = await Promise.all([
        lstat(home),
        lstat(path.join(home, "rpc.sock")),
        lstat(path.join(home, "pm2.pid")),
      ]);
      const uid = process.getuid?.();
      if (
        !dir.isDirectory() ||
        (dir.mode & 0o077) !== 0 ||
        dir.uid !== uid ||
        !socket.isSocket() ||
        socket.uid !== uid ||
        !pidFile.isFile() ||
        pidFile.uid !== uid
      )
        return undefined;
      const pid = Number(await readFile(path.join(home, "pm2.pid"), "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 2) return undefined;
      return (await isDaemon(pid)) ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  async function rpc(
    method: "getMonitorData" | "stopProcessId" | "restartProcessId",
    args: object,
  ) {
    const module = path.join(path.dirname(path.dirname(pm2.entry)), "lib", "Client.js");
    const { stdout } = await exec(
      process.execPath,
      ["-e", rpcProbe, module, method, JSON.stringify(args)],
      { cwd: root, env, timeout: 2_000 },
    );
    return JSON.parse(stdout) as unknown;
  }

  async function registration(): Promise<Registration | undefined> {
    try {
      if ((await realpath(record)) !== record || (await realpath(entry)) !== entry) return;
      return recordSchema.parse(JSON.parse(await readFile(record, "utf8")));
    } catch {
      return undefined;
    }
  }

  async function boundProcess(
    registered: Registration,
  ): Promise<Pm2Process | "missing" | "unknown"> {
    if (!(await daemonPid())) return "unknown";
    try {
      const apps = z.array(processSchema).parse(await rpc("getMonitorData", {}));
      const matches = apps.filter((app) => app.name === serviceName);
      if (!matches.length) return "missing";
      const app = matches[0];
      if (
        matches.length !== 1 ||
        !app ||
        app.namespace !== namespace ||
        app.entry !== entry ||
        app.cwd !== work ||
        app.log !== log ||
        app.interpreter !== process.execPath ||
        app.args?.length !== 2 ||
        app.args[0] !== String(registered.port) ||
        app.args[1] !== registered.version
      )
        return "unknown";
      return app;
    } catch {
      return "unknown";
    }
  }

  return {
    home,
    async register(registration) {
      const value = recordSchema.parse(registration);
      await mkdir(work, { mode: 0o700 });
      await writeFile(entry, fixture, { mode: 0o600, flag: "wx" });
      await writeFile(record, JSON.stringify(value), { mode: 0o600, flag: "wx" });
      const app = {
        name: serviceName,
        namespace,
        script: entry,
        cwd: work,
        args: [String(value.port), value.version],
        interpreter: process.execPath,
        autorestart: false,
        out_file: log,
        error_file: path.join(home, "fixture-error.log"),
        merge_logs: true,
      };
      await writeFile(config, `module.exports = ${JSON.stringify({ apps: [app] })};\n`, {
        mode: 0o600,
        flag: "wx",
      });
    },
    async start() {
      const value = await registration();
      if (!value) return false;
      const app = await boundProcess(value);
      if (typeof app !== "string" && app.status === "online") return true;
      if (!(await portAvailable(value.port))) return false;
      try {
        if (typeof app !== "string") {
          if (app.status !== "stopped" && app.status !== "errored") return false;
          if ((await rpc("restartProcessId", { id: app.id })) !== true) return false;
        } else {
          // The exclusive mkdir makes the only daemon launch a one-time, explicit action.
          if (app !== "unknown" || (await realpath(config)) !== config) return false;
          await mkdir(home, { mode: 0o700 });
          await exec(process.execPath, [pm2.entry, "start", config], {
            cwd: root,
            env,
            timeout: 10_000,
          });
          if (typeof (await boundProcess(value)) === "string") return false;
        }
        await writeFile(wantedRunning, "", { mode: 0o600, flag: "a" });
        return true;
      } catch {
        return false;
      }
    },
    async stop() {
      const value = await registration();
      if (!value) return false;
      const app = await boundProcess(value);
      if (typeof app === "string") return false;
      try {
        if ((await rpc("stopProcessId", { id: app.id })) !== true) return false;
        await rm(wantedRunning, { force: true });
        return true;
      } catch {
        return false;
      }
    },
    async observe() {
      const value = await registration();
      if (!value) return { status: "unknown" };
      const app = await boundProcess(value);
      if (typeof app === "string") return { status: app };
      if (app.status === "stopped")
        return { status: (await fileInfo(wantedRunning)) ? "failed" : "stopped" };
      if (app.status === "errored") return { status: "failed" };
      if (app.status !== "online" || !app.pid) return { status: "unknown" };
      const running = { pid: app.pid, version: value.version };
      try {
        const response = await fetch(`http://127.0.0.1:${value.port}/health`, {
          signal: AbortSignal.timeout(300),
          redirect: "error",
        });
        const body = healthSchema.parse(await response.json());
        if (response.ok && body.pid === app.pid && body.version === value.version)
          return { status: "healthy", ...running };
      } catch {
        // The PM2 process and its HTTP health are separate observations.
      }
      return { status: "unhealthy", ...running };
    },
    async logs() {
      const value = await registration();
      if (
        !value ||
        typeof (await boundProcess(value)) === "string" ||
        (await realpath(log)) !== log
      )
        return "";
      return readFile(log, "utf8");
    },
    async close() {
      const pid = await daemonPid();
      if (!pid) return;
      process.kill(pid, "SIGTERM");
      for (let attempt = 0; attempt < 60; attempt++) {
        if (!(await isDaemon(pid))) {
          // Signal shutdown can leave the Unix socket names on disk after the daemon exits.
          for (const name of ["rpc.sock", "pub.sock"]) {
            const file = path.join(home, name);
            if ((await fileInfo(file))?.isSocket()) await rm(file);
          }
          return;
        }
        await delay(50);
      }
      throw new Error("PM2 experiment failed to shut down");
    },
  };
}
