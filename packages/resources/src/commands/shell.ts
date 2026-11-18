import { existsSync } from "node:fs";
import path from "node:path";
import { powerShellArguments, windowsPowerShell } from "../platform/environment.js";
import { resolveWindowsExecutable } from "./windows.js";

export type ShellName = "sh" | "pwsh" | "powershell" | "cmd";

export interface ShellSelection {
  name: ShellName;
  executable: string;
  args: string[];
}

export class ShellUnavailableError extends Error {
  readonly code = "SHELL_UNAVAILABLE";

  constructor(message = "no usable platform shell was found") {
    super(message);
    this.name = "ShellUnavailableError";
  }
}

function windowsFile(candidate: string): string | null {
  return existsSync(candidate) ? candidate : null;
}

function findPwsh(): string | null {
  const resolved = resolveWindowsExecutable("pwsh", process.cwd());
  if (resolved !== "pwsh") return resolved;
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  return windowsFile(path.join(programFiles, "PowerShell", "7", "pwsh.exe"));
}

function findWindowsPowerShell(): string | null {
  return windowsFile(windowsPowerShell());
}

function findCmd(): string | null {
  const comSpec = process.env.ComSpec;
  if (comSpec !== undefined) {
    const found = windowsFile(comSpec);
    if (found !== null) return found;
  }
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return windowsFile(path.join(root, "System32", "cmd.exe"));
}

function powerShellCommand(command: string): string {
  // Preserve the user's pipeline, then surface a native command's last exit
  // code. PowerShell cmdlet failures become terminating because of Stop.
  return [
    "$ErrorActionPreference = 'Stop'",
    "& {",
    command,
    "}",
    "if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }",
  ].join("\n");
}

function selectWindowsShell(command: string): ShellSelection {
  const pwsh = findPwsh();
  if (pwsh !== null) {
    return {
      name: "pwsh",
      executable: pwsh,
      args: powerShellArguments(powerShellCommand(command)),
    };
  }
  const powershell = findWindowsPowerShell();
  if (powershell !== null) {
    return {
      name: "powershell",
      executable: powershell,
      args: powerShellArguments(powerShellCommand(command)),
    };
  }
  const cmd = findCmd();
  if (cmd !== null) {
    return { name: "cmd", executable: cmd, args: ["/d", "/s", "/c", command] };
  }
  throw new ShellUnavailableError();
}

export function selectShell(command: string): ShellSelection {
  if (process.platform === "win32") return selectWindowsShell(command);

  // Deliberately not bash and not a login shell: the caller gets the minimal
  // POSIX shell, and startup files cannot change behaviour behind its back.
  if (!existsSync("/bin/sh")) throw new ShellUnavailableError();
  return { name: "sh", executable: "/bin/sh", args: ["-c", command] };
}
