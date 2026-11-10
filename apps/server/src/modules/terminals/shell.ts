import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { resolveWindowsExecutable } from "@larness/resources";

async function usable(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsShell(): string {
  const candidate = process.env.ComSpec ?? process.env.COMSPEC;
  if (candidate && path.isAbsolute(candidate) && !candidate.includes("\0")) return candidate;
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.join(root, "System32", "cmd.exe");
}

export async function resolveManualShell(accountShell?: string | null): Promise<string> {
  if (process.platform === "win32") {
    const candidate = accountShell ?? windowsShell();
    if (
      candidate &&
      path.isAbsolute(candidate) &&
      !candidate.includes("\0") &&
      (await usable(candidate))
    )
      return candidate;
    return windowsShell();
  }
  let candidate = accountShell;
  if (candidate === undefined) {
    try {
      candidate = userInfo().shell;
    } catch {
      return "/bin/sh";
    }
  }
  if (!candidate || !path.isAbsolute(candidate) || candidate.includes("\0")) return "/bin/sh";
  try {
    if (!(await stat(candidate)).isFile()) return "/bin/sh";
    await access(candidate, constants.X_OK);
    return candidate;
  } catch {
    return "/bin/sh";
  }
}

// argv stays data: no command text is interpolated into this fixed bootstrap.
// Catch INT only in the waiting parent; exec resets the child's signal handler.
const DEV_SHELL_BOOTSTRAP = `trap ':' INT; (exec "$@"); exec "$0" -i`;
export function terminalLaunch(
  shell: string,
  program?: { executable: string; args: string[] },
  cwd = process.cwd(),
  windowsBootstrap?: string,
  windowsReadyFile?: string,
) {
  if (process.platform === "win32") {
    if (!program) {
      const args = path.basename(shell).toLowerCase() === "cmd.exe" ? ["/d"] : [];
      return { executable: shell, args };
    }
    if (!windowsBootstrap || !windowsReadyFile)
      throw new Error("Windows terminal bootstrap is unavailable");
    const target = resolveWindowsExecutable(program.executable, cwd);
    return {
      executable: process.execPath,
      args: [windowsBootstrap, windowsReadyFile, shell, target, ...program.args],
    };
  }
  return program
    ? {
        executable: "/bin/sh",
        args: ["-i", "-c", DEV_SHELL_BOOTSTRAP, shell, program.executable, ...program.args],
      }
    : { executable: shell, args: ["-i"] };
}
