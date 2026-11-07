import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
export const PM2_VERSION = "7.1.2";
const MAX_OUTPUT = 2 * 1024 * 1024;

export type Pm2UnavailableReason = "npm" | "identity" | "version" | "permissions" | "install";
export type Pm2Global =
  | { status: "ready"; entry: string; version: string; root: string; installed: boolean }
  | { status: "missing" }
  | { status: "unavailable"; reason: Pm2UnavailableReason };

export interface Pm2GlobalOptions {
  npm?: string;
  prefix?: string;
  registry?: string;
  timeoutMs?: number;
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

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

async function runNpm(
  options: Pm2GlobalOptions,
  args: string[],
  timeout = options.timeoutMs ?? 10_000,
) {
  const npm = options.npm ?? "npm";
  const extra = options.prefix ? ["--prefix", options.prefix] : [];
  return exec(npm, [...args, ...extra], {
    env: childEnv(),
    timeout,
    maxBuffer: MAX_OUTPUT,
  });
}

async function globalRoot(options: Pm2GlobalOptions): Promise<string | "unavailable"> {
  if (!options.npm && !process.env.PATH) return "unavailable";
  try {
    const { stdout } = await runNpm(options, ["root", "--global"]);
    const root = stdout.trim();
    if (!path.isAbsolute(root)) return "unavailable";
    if (options.prefix && root !== path.join(options.prefix, "lib", "node_modules")) {
      return "unavailable";
    }
    return root;
  } catch {
    return "unavailable";
  }
}

async function candidate(options: Pm2GlobalOptions): Promise<Pm2Global> {
  const root = await globalRoot(options);
  if (root === "unavailable") return { status: "unavailable", reason: "npm" };
  const realRoot = await realpath(root).catch(() => root);
  const pkg = path.join(root, "pm2");
  const info = await fileInfo(pkg);
  if (!info) return { status: "missing" };
  try {
    const realPkg = await realpath(pkg);
    const entry = path.join(realPkg, "bin", "pm2");
    const manifest = path.join(realPkg, "package.json");
    const [realEntry, realManifest] = await Promise.all([realpath(entry), realpath(manifest)]);
    if (
      !info.isDirectory() ||
      realPkg !== path.join(realRoot, "pm2") ||
      realEntry !== entry ||
      realManifest !== manifest ||
      !(await lstat(entry)).isFile() ||
      !(await lstat(manifest)).isFile()
    ) {
      return { status: "unavailable", reason: "identity" };
    }
    const parsed = z
      .object({ name: z.literal("pm2"), version: z.string() })
      .parse(JSON.parse(await readFile(manifest, "utf8")));
    if (parsed.version !== PM2_VERSION) return { status: "unavailable", reason: "version" };
    return { status: "ready", entry, version: parsed.version, root: realRoot, installed: false };
  } catch {
    return { status: "unavailable", reason: "identity" };
  }
}

export async function inspectGlobalPm2(options: Pm2GlobalOptions = {}): Promise<Pm2Global> {
  return candidate(options);
}

export async function ensureGlobalPm2(options: Pm2GlobalOptions = {}): Promise<Pm2Global> {
  const current = await candidate(options);
  if (current.status !== "missing") return current;
  const prefix =
    options.prefix ??
    (await runNpm(options, ["prefix", "--global"])
      .then(({ stdout }) => stdout.trim())
      .catch(() => ""));
  if (!prefix || !path.isAbsolute(prefix)) return { status: "unavailable", reason: "npm" };
  try {
    const info = await fileInfo(prefix);
    if (info && !info.isDirectory()) return { status: "unavailable", reason: "identity" };
    await mkdir(prefix, { recursive: true, mode: 0o700 });
    await access(prefix, constants.W_OK);
  } catch {
    return { status: "unavailable", reason: "permissions" };
  }
  try {
    await runNpm(
      { ...options, prefix },
      [
        "install",
        `pm2@${PM2_VERSION}`,
        "--global",
        "--ignore-scripts",
        "--omit=optional",
        "--no-audit",
        "--no-fund",
        "--fetch-retries=0",
        "--registry",
        options.registry ?? "https://registry.npmjs.org",
      ],
      options.timeoutMs ?? 65_000,
    );
  } catch {
    return { status: "unavailable", reason: "install" };
  }
  const installed = await candidate({ ...options, prefix });
  return installed.status === "ready" ? { ...installed, installed: true } : installed;
}

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
export type Pm2Process = z.infer<typeof processSchema>;

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

export class Pm2Adapter {
  readonly #global: Extract<Pm2Global, { status: "ready" }>;
  readonly #dataDir: string;
  readonly #home: string;
  readonly #env: NodeJS.ProcessEnv;

  constructor(global: Extract<Pm2Global, { status: "ready" }>, dataDir: string) {
    if (!path.isAbsolute(dataDir)) throw new Error("PM2 data directory must be absolute");
    this.#global = global;
    this.#dataDir = dataDir;
    this.#home = path.join(dataDir, "pm2");
    this.#env = {
      ...childEnv(),
      PM2_HOME: this.#home,
      PM2_DISABLE_MODULES: "true",
      PM2_NO_INTERACTION: "true",
    };
  }

  get home(): string {
    return this.#home;
  }

  async daemonPid(): Promise<number | undefined> {
    try {
      await mkdir(this.#home, { recursive: true, mode: 0o700 });
      const created = await lstat(this.#home);
      if ((created.mode & 0o077) !== 0) await chmod(this.#home, 0o700);
      const [dir, socket, pidFile] = await Promise.all([
        lstat(this.#home),
        lstat(path.join(this.#home, "rpc.sock")),
        lstat(path.join(this.#home, "pm2.pid")),
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
      ) {
        return undefined;
      }
      const pid = Number(await readFile(path.join(this.#home, "pm2.pid"), "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 2) return undefined;
      return (await this.#isDaemon(pid)) ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  async #isDaemon(pid: number): Promise<boolean> {
    try {
      const { stdout } = await exec("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], {
        timeout: 1_000,
      });
      return stdout.trim() === `PM2 v${this.#global.version}: God Daemon (${this.#home})`;
    } catch {
      return false;
    }
  }

  async #rpc(method: string, args: object): Promise<unknown> {
    const module = path.join(path.dirname(path.dirname(this.#global.entry)), "lib", "Client.js");
    const { stdout } = await exec(
      process.execPath,
      ["-e", rpcProbe, module, method, JSON.stringify(args)],
      { cwd: this.#dataDir, env: this.#env, timeout: 3_000, maxBuffer: MAX_OUTPUT },
    );
    return JSON.parse(stdout) as unknown;
  }

  async list(): Promise<Pm2Process[] | "unknown"> {
    if (!(await this.daemonPid())) return "unknown";
    try {
      return z.array(processSchema).parse(await this.#rpc("getMonitorData", {}));
    } catch {
      return "unknown";
    }
  }

  async find(name: string): Promise<Pm2Process | "missing" | "unknown"> {
    const apps = await this.list();
    if (apps === "unknown") return "unknown";
    const matches = apps.filter((app) => app.name === name);
    if (matches.length === 0) return "missing";
    if (matches.length !== 1) return "unknown";
    return matches[0] ?? "unknown";
  }

  async start(configPath: string, name: string, timeoutMs = 15_000): Promise<boolean> {
    try {
      const info = await lstat(configPath);
      if (!info.isFile() || info.isSymbolicLink()) return false;
    } catch {
      return false;
    }
    try {
      const current = await this.find(name);
      if (current !== "missing" && current !== "unknown") {
        await exec(process.execPath, [this.#global.entry, "delete", name, "--no-color"], {
          cwd: this.#dataDir,
          env: this.#env,
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
        });
      }
      await exec(
        process.execPath,
        [this.#global.entry, "startOrRestart", configPath, "--no-color"],
        { cwd: this.#dataDir, env: this.#env, timeout: timeoutMs, maxBuffer: MAX_OUTPUT },
      );
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const app = await this.find(name);
        if (typeof app !== "string" && app.status === "online") return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return false;
    } catch {
      return false;
    }
  }

  async stop(name: string, timeoutMs = 10_000): Promise<boolean> {
    const app = await this.find(name);
    if (app === "unknown" || app === "missing") return false;
    try {
      await exec(process.execPath, [this.#global.entry, "stop", name, "--no-color"], {
        cwd: this.#dataDir,
        env: this.#env,
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT,
      });
      return true;
    } catch {
      return false;
    }
  }

  async restart(name: string, timeoutMs = 10_000, updateEnv = true): Promise<boolean> {
    const app = await this.find(name);
    if (app === "unknown" || app === "missing") return false;
    try {
      await exec(
        process.execPath,
        [this.#global.entry, "restart", name, ...(updateEnv ? ["--update-env"] : []), "--no-color"],
        { cwd: this.#dataDir, env: this.#env, timeout: timeoutMs, maxBuffer: MAX_OUTPUT },
      );
      return true;
    } catch {
      return false;
    }
  }

  async logPath(name: string, expectedLog: string): Promise<string | null> {
    const app = await this.find(name);
    if (app === "unknown" || app === "missing") return null;
    if (app.log !== expectedLog) return null;
    return app.log;
  }

  /** Test/experiment cleanup only. Product shutdown must leave the daemon running. */
  async close(): Promise<void> {
    const pid = await this.daemonPid();
    if (!pid) return;
    process.kill(pid, "SIGTERM");
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (!(await this.#isDaemon(pid))) {
        for (const name of ["rpc.sock", "pub.sock"]) {
          const file = path.join(this.#home, name);
          if ((await fileInfo(file))?.isSocket()) await rm(file);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("PM2 daemon did not stop");
  }
}
