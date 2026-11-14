import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  commandEnvironment,
  powerShellEncodedCommand,
  resolveWindowsExecutable,
  windowsPowerShell,
} from "@larness/resources";

const exec = promisify(execFile);

async function usable(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) return false;
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const DISABLE_POWERSHELL_HISTORY = [
  "Import-Module PSReadLine -ErrorAction Stop",
  "Set-PSReadLineOption -HistorySaveStyle SaveNothing -ErrorAction Stop",
];

async function canStartWindowsShell(file: string, major?: number): Promise<boolean> {
  if (!path.isAbsolute(file) || file.includes("\0") || !(await usable(file))) return false;
  const args =
    major === undefined
      ? ["/d", "/c", "exit 0"]
      : [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          powerShellEncodedCommand(
            [
              `if ($PSVersionTable.PSVersion.Major -ne ${major}) { exit 1 }`,
              "trap { exit 1 }",
              ...DISABLE_POWERSHELL_HISTORY,
              "exit 0",
            ].join("\n"),
          ),
        ];
  try {
    await exec(file, args, {
      cwd: path.dirname(file),
      env: commandEnvironment(),
      timeout: 3000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveWindowsShell(): Promise<string> {
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!path.isAbsolute(directory)) continue;
    const file = path.join(directory, "pwsh.exe");
    if (await canStartWindowsShell(file, 7)) return file;
  }
  const legacyPowerShell = windowsPowerShell();
  if (await canStartWindowsShell(legacyPowerShell, 5)) return legacyPowerShell;
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const cmd = path.join(root, "System32", "cmd.exe");
  if (await canStartWindowsShell(cmd)) return cmd;
  throw new Error("No supported Windows terminal shell is available");
}

function windowsInteractiveArgs(shell: string): string[] {
  switch (path.basename(shell).toLowerCase()) {
    case "cmd.exe":
      return ["/d"];
    case "pwsh.exe":
    case "powershell.exe":
      return [
        "-NoLogo",
        "-NoProfile",
        "-NoExit",
        "-EncodedCommand",
        powerShellEncodedCommand(
          ["& {", "  trap { exit 1 }", ...DISABLE_POWERSHELL_HISTORY, "}"].join("\n"),
        ),
      ];
    default:
      return [];
  }
}

export async function resolveManualShell(accountShell?: string | null): Promise<string> {
  if (process.platform === "win32") return resolveWindowsShell();
  let candidate = accountShell;
  if (candidate === undefined) {
    try {
      candidate = userInfo().shell;
    } catch {
      return "/bin/sh";
    }
  }
  if (!candidate || !path.isAbsolute(candidate) || candidate.includes("\0")) return "/bin/sh";
  return (await usable(candidate)) ? candidate : "/bin/sh";
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
    const shellArgs = windowsInteractiveArgs(shell);
    if (!program) return { executable: shell, args: shellArgs };
    if (!windowsBootstrap || !windowsReadyFile)
      throw new Error("Windows terminal bootstrap is unavailable");
    const target = resolveWindowsExecutable(program.executable, cwd);
    return {
      executable: process.execPath,
      args: [
        windowsBootstrap,
        windowsReadyFile,
        shell,
        JSON.stringify(shellArgs),
        target,
        ...program.args,
      ],
    };
  }
  return program
    ? {
        executable: "/bin/sh",
        args: ["-i", "-c", DEV_SHELL_BOOTSTRAP, shell, program.executable, ...program.args],
      }
    : { executable: shell, args: ["-i"] };
}
