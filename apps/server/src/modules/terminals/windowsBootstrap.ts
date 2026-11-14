import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fixed bootstrap used as the ConPTY root on Windows.
 *
 * It starts the approved program with inherited console handles, then hands the
 * same PTY to an interactive shell after the program exits. Unlike a PowerShell
 * command line, this preserves every argument byte-for-byte for native
 * executables and keeps Ctrl+C from closing the terminal.
 */
export const WINDOWS_TERMINAL_BOOTSTRAP = `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [readyFile, shell, shellArgs, program, ...args] = process.argv.slice(2);
function markReady() { try { writeFileSync(readyFile, "ready"); } catch {} }
process.on("SIGINT", () => {});
process.on("SIGHUP", () => {});
let handedOver = false;
function startShell(code) {
  if (handedOver) return;
  handedOver = true;
  const child = spawn(shell, JSON.parse(shellArgs), { stdio: "inherit", windowsHide: false });
  child.on("error", () => process.exit(code ?? 1));
  child.on("exit", (value) => process.exit(value ?? code ?? 0));
}
function literal(value) {
  return "'" + value.replaceAll("'", "''") + "'";
}
function runProgram() {
  if (/\\.(cmd|bat)$/i.test(program)) {
    const script = "$ErrorActionPreference = 'Continue'\\n& " + [program, ...args].map(literal).join(" ");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const powershell = (process.env.SystemRoot || "C:\\\\Windows") + "\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe";
    const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { stdio: "inherit", windowsHide: false });
    markReady();
    child.on("error", (error) => { console.error("Larness: " + error.message); startShell(1); });
    child.on("exit", (code) => startShell(code));
    return;
  }
  const child = spawn(program, args, { stdio: "inherit", windowsHide: false });
  markReady();
  child.on("error", (error) => { console.error("Larness: " + error.message); startShell(1); });
  child.on("exit", (code) => startShell(code));
}
runProgram();
`;

/** Wait until the bootstrap has spawned the approved program. */
export async function waitForWindowsBootstrap(file: string, timeoutMs = 10_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      await rm(file, { force: true }).catch(() => undefined);
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await rm(file, { force: true }).catch(() => undefined);
  return false;
}

export async function ensureWindowsTerminalBootstrap(dataDir: string): Promise<string> {
  const directory = path.join(dataDir, "tmp");
  const file = path.join(directory, "windows-terminal-bootstrap.mjs");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    if ((await readFile(file, "utf8")) === WINDOWS_TERMINAL_BOOTSTRAP) return file;
  } catch {
    // Missing or stale; rewrite below.
  }
  await writeFile(file, WINDOWS_TERMINAL_BOOTSTRAP, { mode: 0o600 });
  return file;
}
