import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { terminateProcessTree } from "@larness/resources";
import pc from "picocolors";
import {
  configFilePath,
  type LoadedConfig,
  loadConfig,
  resolveConfig,
} from "../bootstrap/config.js";
import { inspectPendingInitialization } from "../db/inspect.js";
import { findServerRoot } from "../db/migrate.js";
import {
  DevWebAttachedSchema,
  DevWebControl,
  devWebCache,
  EntryConfigError,
} from "../dev-web/control.js";
import { waitChildMessage } from "../dev-web/managed.js";
import { resolveDataDir } from "../platform/paths.js";

const READY_TIMEOUT_MS = 90_000;
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

  if (
    canonical.protocol === "http:" &&
    isLoopbackHostname(canonical.hostname) &&
    originPort(options.canonicalOrigin) !== options.serverPort
  ) {
    throw new EntryConfigError(options.canonicalOrigin, options.serverPort);
  }
  return options.publicUrl ?? localUrl;
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
  devFailed: Promise<void>;
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
  // Node's --import accepts module specifiers/URLs; a bare Windows drive path
  // is parsed as the unsupported "c:" scheme.
  const tsxLoader = pathToFileURL(serverRequire.resolve("tsx/esm")).href;

  return {
    serverCommand: nodePath,
    serverArgs: [
      "--import",
      tsxLoader,
      path.join(options.serverRoot, "src", "index.ts"),
      "--managed-dev-web",
    ],
    serverCwd: options.serverRoot,
    webCommand: nodePath,
    webArgs: [
      "--import",
      tsxLoader,
      path.join(options.repoRoot, "apps", "web", "scripts", "managed-vite.ts"),
    ],
    webCwd: path.join(options.repoRoot, "apps", "web"),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpOk(url: string, requireHtml = false, host?: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      ...(host ? { headers: { host } } : {}),
    });

    const ready =
      response.ok &&
      (!requireHtml || (response.headers.get("content-type") ?? "").includes("text/html"));
    // Finish probes so shutdown never waits on unread development resources.
    await response.arrayBuffer();
    return ready;
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
    host?: string;
  } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? READY_TIMEOUT_MS);

  while (Date.now() < deadline) {
    if (
      child.exitCode !== null ||
      child.signalCode !== null ||
      options.failed?.() === true ||
      options.signal?.aborted === true
    ) {
      return false;
    }

    if (await httpOk(url, options.requireHtml, options.host)) {
      return true;
    }

    await delay(200);
  }

  return false;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
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

async function stopChild(
  child: ChildProcess | null,
  timeoutMs: number,
  graceful: "signal" | "message" | "disconnect" = "signal",
): Promise<void> {
  if (child === null || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    if (graceful === "message" && child.connected) {
      child.send({ type: "larness.shutdown" });
    } else if (graceful === "disconnect" && child.connected) {
      child.disconnect();
    }
    if (await waitForExit(child, timeoutMs)) return;
    await terminateProcessTree(child.pid, 2_000);
    await waitForExit(child, 2_000);
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
  const loaded: LoadedConfig = await loadManagedConfig(dataDir);
  const port = loaded.config.server.port;
  const localBase = `http://127.0.0.1:${port}`;
  const serverUrl = `http://localhost:${port}`;
  const canonicalOrigin = loaded.webAuthn.origin;
  const webUrl = resolveWebUrl({
    dev: options.dev,
    serverPort: port,
    publicUrl: loaded.config.server.publicUrl,
    canonicalOrigin,
  });
  if (await httpOk(`${localBase}/api/health`))
    throw new Error(`已有 Larness Server 在 ${serverUrl} 运行；请先关闭原 TUI。`);
  const commands = managedCommands({ dev: options.dev, serverRoot: root, repoRoot });
  const logs: string[] = [];
  const appendLog = (prefix: string, chunk: Buffer): void => {
    for (const line of chunk.toString("utf8").split(/\r?\n/))
      if (line.trim()) logs.push(`${prefix} ${line}`);
    if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
  };
  let server: ChildProcess | null = null;
  let web: ChildProcess | null = null;
  let stopped = false;
  let ownedCache: string | null = null;
  let stopping: Promise<void> | null = null;
  let resolveServerExit: () => void = () => undefined;
  const serverExited = new Promise<void>((resolve) => {
    resolveServerExit = resolve;
  });
  let resolveDevFailure: () => void = () => undefined;
  const devFailed = new Promise<void>((resolve) => {
    resolveDevFailure = resolve;
  });
  const forceKill = () => {
    server?.kill("SIGKILL");
    web?.kill("SIGKILL");
  };
  process.once("exit", forceKill);
  const stop = (): Promise<void> => {
    stopped = true;
    stopping ??= (async () => {
      try {
        await stopChild(server, 10_000, "message");
      } finally {
        try {
          await stopChild(web, 5_000, "disconnect");
        } finally {
          try {
            if (ownedCache) await rm(ownedCache, { recursive: true, force: true });
          } finally {
            process.off("exit", forceKill);
          }
        }
      }
    })();
    return stopping;
  };
  const observe = (child: ChildProcess, prefix: string) => {
    child.stdout?.on("data", (chunk: Buffer) => appendLog(prefix, chunk));
    child.stderr?.on("data", (chunk: Buffer) => appendLog(prefix, chunk));
    child.on("error", () => {
      if (options.dev && !stopped) resolveDevFailure();
    });
    child.on("exit", () => {
      if (options.dev && !stopped) resolveDevFailure();
    });
    if (options.dev)
      child.on("disconnect", () => {
        if (!stopped) resolveDevFailure();
      });
  };
  try {
    const generation = randomUUID();
    let target: import("../dev-web/control.js").DevWebTarget | null = null;
    if (options.dev) {
      options.signal?.throwIfAborted();
      web = spawn(commands.webCommand ?? process.execPath, commands.webArgs, {
        cwd: commands.webCwd ?? repoRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      observe(web, "[web]");
      const control = new DevWebControl(web, generation);
      const child = web;
      const ready = waitChildMessage(
        child,
        (message) => (control.accept(child, message) ? control.target : null),
        options.signal,
        "Vite",
      );
      child.send({ type: "dev-web.start", generation, origin: canonicalOrigin });
      target = await ready;
      ownedCache = devWebCache(target.generation);
    }
    options.signal?.throwIfAborted();
    server = spawn(commands.serverCommand, commands.serverArgs, {
      cwd: commands.serverCwd,
      env: {
        ...process.env,
        LARNESS_LOG_STDERR: "0",
        LARNESS_TUI_CHILD: "1",
        LARNESS_PM2_AUTO_INSTALL: process.env.LARNESS_PM2_AUTO_INSTALL ?? "1",
        ...(options.dev ? { LARNESS_SERVE_WEB: "0" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    observe(server, "[server]");
    server.once("exit", resolveServerExit);
    if (target) {
      const attached = waitChildMessage(
        server,
        (message) => {
          const parsed = DevWebAttachedSchema.safeParse(message);
          return parsed.success && parsed.data.generation === generation ? true : null;
        },
        options.signal,
      );
      server.send({ type: "dev-web.attach", ...target });
      await attached;
    }
    const serverReady = await waitForHttp(`${localBase}/api/health`, server, {
      signal: options.signal,
    });
    const host = new URL(canonicalOrigin).host;
    const webReady =
      serverReady &&
      (await waitForHttp(`${localBase}/`, server, {
        requireHtml: true,
        signal: options.signal,
        host,
        timeoutMs: options.dev ? READY_TIMEOUT_MS : 5_000,
      }));
    const resourcesReady =
      !options.dev ||
      (await waitForHttp(`${localBase}/@vite/client`, server, { signal: options.signal, host }));
    if (
      !serverReady ||
      !webReady ||
      !resourcesReady ||
      (web?.exitCode !== null && web !== null) ||
      (web?.signalCode !== null && web !== null)
    )
      throw new Error("Server 或 Web 未就绪；请查看本机日志，打包模式请先运行 pnpm build。");
    if (!existsSync(path.join(dataDir, "ipc", "token"))) throw new Error("IPC 尚未就绪");
  } catch (error) {
    await stop();
    throw error;
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
    devFailed,
  };
}
