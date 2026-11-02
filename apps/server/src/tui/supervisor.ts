import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pc from "picocolors";
import {
  configFilePath,
  type LoadedConfig,
  loadConfig,
  resolveConfig,
} from "../bootstrap/config.js";
import { inspectPendingInitialization } from "../db/inspect.js";
import { findServerRoot } from "../db/migrate.js";
import { resolveDataDir } from "../platform/paths.js";

const WEB_DEV_URL = "http://localhost:5173";
const READY_TIMEOUT_MS = 25_000;
const LOG_LIMIT = 300;

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function originPort(origin: string): number {
  const parsed = new URL(origin);
  return Number(parsed.port || (parsed.protocol === "https:" ? "443" : "80"));
}

export function resolveWebUrl(options: {
  dev: boolean;
  serverPort: number;
  publicUrl: string | null;
  canonicalOrigin: string;
}): string {
  const localUrl = `http://localhost:${options.serverPort}`;
  const canonical = new URL(options.canonicalOrigin);

  if (isLoopbackHostname(canonical.hostname)) {
    const expectedPort = options.dev ? 5173 : options.serverPort;

    if (originPort(options.canonicalOrigin) !== expectedPort) {
      throw new Error(
        options.dev
          ? `当前数据目录的 canonical origin 是 ${options.canonicalOrigin}，但开发 Web 固定为 ${WEB_DEV_URL}。请使用独立的开发数据目录，或设置 LARNESS_PUBLIC_URL=${WEB_DEV_URL} 后重试。`
          : `当前数据目录的 canonical origin 是 ${options.canonicalOrigin}，但生产静态 Web 在 ${localUrl}。请使用独立的生产数据目录并让 publicUrl 留空，或将 publicUrl 改为 ${localUrl}，或设置 LARNESS_PORT=5173 复用当前配置。`,
      );
    }
  }

  return options.dev ? WEB_DEV_URL : (options.publicUrl ?? localUrl);
}

export interface ManagedCommands {
  serverCommand: string;
  serverArgs: string[];
  serverCwd: string;
  webCommand: string | null;
  webArgs: string[];
  webCwd: string | null;
}

export interface ManagedRuntime {
  dataDir: string;
  config: LoadedConfig;
  dev: boolean;
  serverUrl: string;
  webUrl: string;
  logs(): string[];
  stop(): Promise<void>;
  serverExited: Promise<void>;
}

export interface StartManagedRuntimeOptions {
  dev: boolean;
  out?: (text: string) => void;
  signal?: AbortSignal;
}

function serverRoot(): string {
  return findServerRoot(path.dirname(fileURLToPath(import.meta.url)));
}

export function managedCommands(options: {
  dev: boolean;
  serverRoot: string;
  repoRoot: string;
  nodePath?: string;
}): ManagedCommands {
  const nodePath = options.nodePath ?? process.execPath;

  if (!options.dev) {
    return {
      serverCommand: nodePath,
      serverArgs: [path.join(options.serverRoot, "dist", "index.js")],
      serverCwd: options.serverRoot,
      webCommand: null,
      webArgs: [],
      webCwd: null,
    };
  }

  const serverRequire = createRequire(path.join(options.serverRoot, "package.json"));
  const webRequire = createRequire(path.join(options.repoRoot, "apps", "web", "package.json"));
  const tsxLoader = serverRequire.resolve("tsx/esm");
  const vitePackage = webRequire.resolve("vite/package.json");
  const viteBin = path.join(path.dirname(vitePackage), "bin", "vite.js");

  return {
    serverCommand: nodePath,
    serverArgs: ["--import", tsxLoader, path.join(options.serverRoot, "src", "index.ts")],
    serverCwd: options.serverRoot,
    webCommand: nodePath,
    webArgs: [viteBin],
    webCwd: path.join(options.repoRoot, "apps", "web"),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpOk(url: string, requireHtml = false): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500) });

    if (!response.ok) {
      return false;
    }

    return requireHtml ? (response.headers.get("content-type") ?? "").includes("text/html") : true;
  } catch {
    return false;
  }
}

async function waitForHttp(
  url: string,
  child: ChildProcess,
  options: {
    requireHtml?: boolean;
    timeoutMs?: number;
    failed?: () => boolean;
    signal?: AbortSignal;
  } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? READY_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (
      child.exitCode !== null ||
      options.failed?.() === true ||
      options.signal?.aborted === true
    ) {
      return false;
    }

    if (await httpOk(url, options.requireHtml)) {
      return true;
    }

    await delay(200);
  }

  return false;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function stopChild(child: ChildProcess | null, timeoutMs: number): Promise<void> {
  if (child === null || child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");

  if (await waitForExit(child, timeoutMs)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForExit(child, 2_000);
}

export async function loadManagedConfig(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LoadedConfig> {
  const pending = inspectPendingInitialization(path.join(dataDir, "larness.db"));
  return pending === null
    ? loadConfig({ dataDir, env })
    : { ...resolveConfig(pending, env), source: "file", path: configFilePath(dataDir) };
}

export async function startManagedRuntime(
  options: StartManagedRuntimeOptions,
): Promise<ManagedRuntime> {
  options.signal?.throwIfAborted();
  const out = options.out ?? console.log;
  const root = serverRoot();
  const repoRoot = path.resolve(root, "../..");
  const dataDir = resolveDataDir();
  let loaded: LoadedConfig = await loadManagedConfig(dataDir);
  const port = loaded.config.server.port;
  const localBase = `http://127.0.0.1:${port}`;
  const serverUrl = `http://localhost:${port}`;
  const firstRun = loaded.source === "defaults";
  const canonicalOrigin =
    options.dev && firstRun && process.env.LARNESS_PUBLIC_URL === undefined
      ? WEB_DEV_URL
      : loaded.webAuthn.origin;
  const webUrl = resolveWebUrl({
    dev: options.dev,
    serverPort: port,
    publicUrl: loaded.config.server.publicUrl,
    canonicalOrigin,
  });

  if (await httpOk(`${localBase}/api/health`)) {
    throw new Error(`已有 Larness Server 在 ${serverUrl} 运行；请先关闭原 TUI。`);
  }

  const commands = managedCommands({ dev: options.dev, serverRoot: root, repoRoot });
  const logs: string[] = [];
  const appendLog = (prefix: string, chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (line.trim().length > 0) {
        logs.push(`${prefix} ${line}`);
      }
    }

    if (logs.length > LOG_LIMIT) {
      logs.splice(0, logs.length - LOG_LIMIT);
    }
  };

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    LARNESS_LOG_STDERR: "0",
    LARNESS_TUI_CHILD: "1",
    ...(options.dev ? { LARNESS_SERVE_WEB: "0" } : {}),
  };

  if (options.dev && firstRun && process.env.LARNESS_PUBLIC_URL === undefined) {
    serverEnv.LARNESS_PUBLIC_URL = WEB_DEV_URL;
  }

  loaded = { ...loaded, ...resolveConfig(loaded.config, serverEnv) };

  const server = spawn(commands.serverCommand, commands.serverArgs, {
    cwd: commands.serverCwd,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverSpawnError: Error | null = null;
  server.stdout?.on("data", (chunk: Buffer) => appendLog("[server]", chunk));
  server.stderr?.on("data", (chunk: Buffer) => appendLog("[server]", chunk));
  server.on("error", (error) => {
    serverSpawnError = error;
    appendLog("[server]", Buffer.from(error.message));
  });

  let serverExitResolved = false;
  let resolveServerExit: () => void = () => undefined;
  const serverExited = new Promise<void>((resolve) => {
    resolveServerExit = () => {
      if (!serverExitResolved) {
        serverExitResolved = true;
        resolve();
      }
    };
  });
  server.once("exit", resolveServerExit);

  let web: ChildProcess | null = null;
  let webSpawnError: Error | null = null;

  if (options.dev) {
    web = spawn(commands.webCommand ?? "pnpm", commands.webArgs, {
      cwd: commands.webCwd ?? repoRoot,
      env: {
        ...process.env,
        LARNESS_API_URL: `http://127.0.0.1:${port}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    web.stdout?.on("data", (chunk: Buffer) => appendLog("[web]", chunk));
    web.stderr?.on("data", (chunk: Buffer) => appendLog("[web]", chunk));
    web.on("error", (error) => {
      webSpawnError = error;
      appendLog("[web]", Buffer.from(error.message));
    });
  }

  const forceKill = (): void => {
    if (server.exitCode === null) {
      server.kill("SIGKILL");
    }
    if (web !== null && web.exitCode === null) {
      web.kill("SIGKILL");
    }
  };
  process.once("exit", forceKill);

  let stopping: Promise<void> | null = null;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      try {
        await stopChild(server, 10_000);
        await stopChild(web, 5_000);
      } finally {
        process.off("exit", forceKill);
      }
    })();
    return stopping;
  };

  try {
    const serverReady = await waitForHttp(`${localBase}/api/health`, server, {
      failed: () => serverSpawnError !== null,
      signal: options.signal,
    });
    const webReady = serverReady
      ? await waitForHttp(
          options.dev ? `${WEB_DEV_URL}/` : `${localBase}/`,
          options.dev ? (web as ChildProcess) : server,
          {
            requireHtml: true,
            timeoutMs: options.dev ? READY_TIMEOUT_MS : 5_000,
            failed: options.dev ? () => webSpawnError !== null : () => serverSpawnError !== null,
            signal: options.signal,
          },
        )
      : false;

    if (!serverReady || !webReady) {
      const detail = logs.slice(-12).join("\n");
      throw new Error(
        [
          !serverReady ? `Server 未能在 ${serverUrl} 就绪` : null,
          !webReady ? `Web 未能在 ${webUrl} 就绪` : null,
          options.dev ? null : "如果 Web 构建缺失，请先运行 pnpm build。",
          detail.length > 0 ? `\n最近输出:\n${detail}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }

    if (!existsSync(path.join(dataDir, "ipc", "token"))) {
      throw new Error("Server 已启动，但 IPC Token 尚未就绪。");
    }
  } catch (error) {
    await stop();
    throw error;
  }

  if (options.dev && canonicalOrigin !== WEB_DEV_URL) {
    out(
      pc.yellow(
        `! canonical origin 是 ${canonicalOrigin}，与开发 Web ${WEB_DEV_URL} 不一致；Passkey 将不可用。`,
      ),
    );
  }

  out(pc.bold("Larness"));
  out(`${pc.green("✓")} 数据目录 ${dataDir}`);
  out(`${pc.green("✓")} Server  ${serverUrl}`);
  out(`${pc.green("✓")} Web     ${webUrl}`);
  out(`${pc.green("✓")} IPC     ${path.join(dataDir, "ipc")}`);

  return {
    dataDir,
    config: loaded,
    dev: options.dev,
    serverUrl,
    webUrl,
    logs: () => [...logs],
    stop,
    serverExited,
  };
}
