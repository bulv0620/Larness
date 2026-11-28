import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, type FileHandle, mkdir, open, rename, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectInstanceLock, isProcessAlive } from "../bootstrap/lock.js";
import { findServerRoot } from "../db/migrate.js";
import { ipcTokenPath } from "../ipc/address.js";
import { connectIpc } from "../ipc/client.js";
import { resolveDataDir } from "../platform/paths.js";
import { loadManagedConfig } from "../tui/supervisor.js";
import { EXIT_FAILURE, EXIT_NOT_RUNNING, EXIT_OK } from "./args.js";

const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 15_000;
const DAEMON_LOG_LIMIT_BYTES = 5 * 1_048_576;

export interface LifecycleIo {
  stdout(text: string): void;
  stderr(text: string): void;
  env: NodeJS.ProcessEnv;
}

export interface StartCommandOptions {
  root?: string;
  webDist?: string;
  readyTimeoutMs?: number;
}

function serverRoot(): string {
  return findServerRoot(path.dirname(fileURLToPath(import.meta.url)));
}

export function daemonLogPath(dataDir: string): string {
  return path.join(dataDir, "logs", "daemon.log");
}

async function httpOk(url: string, timeoutMs = 1_500): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

async function rotateDaemonLog(file: string): Promise<void> {
  try {
    const info = await stat(file);
    if (info.size < DAEMON_LOG_LIMIT_BYTES) return;
    await rename(file, `${file}.1`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function openDaemonLog(dataDir: string): Promise<FileHandle> {
  const logsDir = path.join(dataDir, "logs");
  await mkdir(logsDir, { recursive: true, mode: 0o700 });
  const file = daemonLogPath(dataDir);
  await rotateDaemonLog(file);
  const handle = await open(file, "a", 0o600);

  if (process.platform !== "win32") {
    await chmod(file, 0o600);
  }

  return handle;
}

function webDistDir(root: string, env: NodeJS.ProcessEnv): string {
  return env.LARNESS_WEB_DIST ?? path.resolve(root, "../../apps/web/dist");
}

function tuiEntry(root: string): { command: string; args: string[] } | null {
  const dist = path.join(root, "dist", "tui.js");
  if (existsSync(dist)) return { command: process.execPath, args: [dist, "--attach"] };

  const source = path.join(root, "src", "tui", "main.ts");
  if (!existsSync(source)) return null;

  const require = createRequire(path.join(root, "package.json"));
  const loader = pathToFileURL(require.resolve("tsx/esm")).href;
  return { command: process.execPath, args: ["--import", loader, source, "--attach"] };
}

async function requestShutdown(dataDir: string): Promise<boolean> {
  try {
    const client = await connectIpc({ dataDir, client: "cli", timeoutMs: 2_000 });
    try {
      await client.request("server.shutdown", { confirm: true, source: "cli" }, 5_000);
      return true;
    } finally {
      client.close();
    }
  } catch {
    return false;
  }
}

export async function startCommand(
  io: LifecycleIo,
  options: StartCommandOptions = {},
): Promise<number> {
  const dataDir = resolveDataDir(io.env);
  const loaded = await loadManagedConfig(dataDir, io.env);
  const port = loaded.config.server.port;
  const health = `http://127.0.0.1:${port}/api/health`;

  if (await httpOk(health)) {
    const lock = await inspectInstanceLock(dataDir);
    const pid = lock?.record?.pid;
    const mode = lock?.record?.mode ?? "unknown";
    const dev = lock?.record?.dev === true ? " dev" : "";
    io.stdout(`[larness] already running (${mode}${dev})${pid ? `, pid ${pid}` : ""}\n`);
    io.stdout(`[larness] web ${loaded.config.server.publicUrl ?? `http://localhost:${port}`}\n`);
    return EXIT_OK;
  }

  const root = options.root ?? serverRoot();
  const entry = path.join(root, "dist", "index.js");

  if (!existsSync(entry)) {
    io.stderr("[larness] start needs a built server: apps/server/dist/index.js is missing.\n");
    io.stderr("[larness] run `pnpm build` for a packaged run, or `pnpm dev` for development.\n");
    return EXIT_FAILURE;
  }

  const webDist = options.webDist ?? webDistDir(root, io.env);

  if (io.env.LARNESS_SERVE_WEB !== "0" && !existsSync(path.join(webDist, "index.html"))) {
    io.stderr("[larness] the built web app is missing: apps/web/dist/index.html not found.\n");
    io.stderr("[larness] run `pnpm build` before `larness start`.\n");
    return EXIT_FAILURE;
  }

  let logHandle: FileHandle;
  try {
    logHandle = await openDaemonLog(dataDir);
  } catch (error) {
    io.stderr(
      `[larness] cannot open ${daemonLogPath(dataDir)}: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return EXIT_FAILURE;
  }

  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [entry], {
      cwd: root,
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: {
        ...io.env,
        LARNESS_LIFECYCLE_MODE: "background",
        LARNESS_LOG_STDERR: "0",
        LARNESS_PM2_AUTO_INSTALL: io.env.LARNESS_PM2_AUTO_INSTALL ?? "1",
      },
    });
  } finally {
    await logHandle.close();
  }

  child.unref();

  if (child.pid === undefined) {
    io.stderr("[larness] failed to spawn the server process.\n");
    return EXIT_FAILURE;
  }

  const pid = child.pid;
  const token = ipcTokenPath(dataDir);
  const ready = await waitUntil(async () => {
    if (!isProcessAlive(pid)) return false;
    const lock = await inspectInstanceLock(dataDir);
    if (lock?.record?.pid !== pid) return false;
    return existsSync(token) && (await httpOk(health));
  }, options.readyTimeoutMs ?? READY_TIMEOUT_MS);

  if (!ready) {
    const lock = await inspectInstanceLock(dataDir);
    if (lock?.record?.pid === pid && (await requestShutdown(dataDir))) {
      await waitUntil(async () => !isProcessAlive(pid), 10_000);
    }
    io.stderr(
      `[larness] the server did not become ready in ${
        (options.readyTimeoutMs ?? READY_TIMEOUT_MS) / 1_000
      }s.\n`,
    );
    io.stderr(`[larness] pid ${pid}; see ${daemonLogPath(dataDir)}\n`);
    return EXIT_FAILURE;
  }

  const webUrl = loaded.config.server.publicUrl ?? `http://localhost:${port}`;
  io.stdout(`[larness] server started, pid ${pid}\n`);
  io.stdout(`[larness] web ${webUrl}\n`);
  io.stdout(`[larness] logs ${daemonLogPath(dataDir)}\n`);
  return EXIT_OK;
}

export async function stopCommand(io: LifecycleIo): Promise<number> {
  const dataDir = resolveDataDir(io.env);
  const lock = await inspectInstanceLock(dataDir);

  if (lock === null) {
    io.stdout("[larness] not running\n");
    return EXIT_OK;
  }

  if (!lock.alive) {
    io.stdout("[larness] not running (stale lock; it is replaced on the next start)\n");
    return EXIT_OK;
  }

  const pid = lock.record?.pid ?? null;

  if (!(await requestShutdown(dataDir))) {
    io.stderr("[larness] the server is running but its IPC endpoint is unreachable.\n");
    io.stderr(`[larness] pid ${pid ?? "unknown"}; data ${dataDir}\n`);
    io.stderr("[larness] no signal was sent and the lock was left untouched.\n");
    return EXIT_FAILURE;
  }

  const stopped = await waitUntil(async () => {
    const current = await inspectInstanceLock(dataDir);
    return current === null || !current.alive;
  }, STOP_TIMEOUT_MS);

  if (!stopped) {
    io.stderr(`[larness] the server did not stop within ${STOP_TIMEOUT_MS / 1_000}s.\n`);
    io.stderr(`[larness] pid ${pid ?? "unknown"}; it may still be running.\n`);
    return EXIT_FAILURE;
  }

  io.stdout("[larness] management server stopped.\n");
  io.stdout("[larness] PM2 services and deployments keep running.\n");
  return EXIT_OK;
}

export async function restartCommand(io: LifecycleIo): Promise<number> {
  const dataDir = resolveDataDir(io.env);
  const lock = await inspectInstanceLock(dataDir);
  const record = lock?.alive === true ? lock.record : null;

  if (record?.mode === "foreground" || record?.dev === true) {
    io.stderr("[larness] this is a foreground dev instance started by `pnpm dev`.\n");
    io.stderr("[larness] restart it in that terminal; `larness restart` will not take it over.\n");
    return EXIT_FAILURE;
  }

  const stopped = await stopCommand(io);
  if (stopped !== EXIT_OK) return stopped;
  return startCommand(io);
}

export async function tuiCommand(io: LifecycleIo): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    io.stderr("[larness] the TUI needs an interactive terminal (TTY).\n");
    return EXIT_FAILURE;
  }

  const dataDir = resolveDataDir(io.env);
  const lock = await inspectInstanceLock(dataDir);

  if (lock === null || !lock.alive) {
    io.stderr("[larness] not running; run `larness start` first.\n");
    return EXIT_NOT_RUNNING;
  }

  const root = serverRoot();
  const entry = tuiEntry(root);

  if (entry === null) {
    io.stderr("[larness] apps/server/dist/tui.js is missing; run `pnpm build`.\n");
    return EXIT_FAILURE;
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(entry.command, entry.args, {
      cwd: root,
      stdio: "inherit",
      env: io.env,
    });
    const swallowInterrupt = () => undefined;
    const forwardTerm = () => child.kill("SIGTERM");
    process.on("SIGINT", swallowInterrupt);
    process.on("SIGTERM", forwardTerm);

    const finish = (code: number) => {
      process.off("SIGINT", swallowInterrupt);
      process.off("SIGTERM", forwardTerm);
      resolve(code);
    };

    child.once("error", () => {
      io.stderr("[larness] failed to start the TUI process.\n");
      finish(EXIT_FAILURE);
    });
    child.once("exit", (code, signal) => {
      finish(code ?? (signal === null ? EXIT_FAILURE : EXIT_FAILURE));
    });
  });
}
