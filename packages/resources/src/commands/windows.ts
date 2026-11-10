import { statSync } from "node:fs";
import path from "node:path";
import {
  powerShellArguments,
  powerShellLiteral,
  windowsPowerShell,
} from "../platform/environment.js";

export interface WindowsLaunch {
  executable: string;
  args: string[];
  /** True when PowerShell is only a launcher for a .cmd/.bat/.ps1 target. */
  shim: boolean;
}

function fileExists(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function extensions(): string[] {
  const value = process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return value
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function withExtensions(candidate: string): string[] {
  if (path.extname(candidate)) return [candidate];
  // Node package managers often ship an extensionless POSIX shim next to the
  // .cmd/.ps1 wrappers. CreateProcess can only run the PATHEXT forms.
  return extensions().map((extension) => `${candidate}${extension}`);
}

/** Resolve a Windows executable without invoking cmd.exe. */
export function resolveWindowsExecutable(executable: string, cwd: string): string {
  const hasSeparator = executable.includes("\\") || executable.includes("/");
  if (path.isAbsolute(executable) || hasSeparator) {
    const base = path.resolve(cwd, executable);
    for (const candidate of withExtensions(base)) if (fileExists(candidate)) return candidate;
    return base;
  }
  for (const directory of (process.env.PATH ?? "").split(";")) {
    const trimmed = directory.trim().replace(/^"(.*)"$/, "$1");
    if (!trimmed) continue;
    for (const candidate of withExtensions(path.join(trimmed, executable))) {
      if (fileExists(candidate)) return candidate;
    }
  }
  return executable;
}

function scriptInvocation(target: string, args: string[]): WindowsLaunch {
  const command = [`& ${powerShellLiteral(target)}`, ...args.map(powerShellLiteral)].join(" ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    command,
    "if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }",
  ].join("\n");
  return {
    executable: windowsPowerShell(),
    args: powerShellArguments(script),
    shim: true,
  };
}

/**
 * Windows cannot CreateProcess a .cmd/.bat shim directly. Launch those (and
 * .ps1 scripts) through an encoded PowerShell script so every argument stays a
 * literal instead of being interpolated into a shell command line.
 */
export function windowsLaunch(executable: string, args: string[], cwd: string): WindowsLaunch {
  const target = resolveWindowsExecutable(executable, cwd);
  const extension = path.extname(target).toLowerCase();
  if (extension === ".cmd" || extension === ".bat" || extension === ".ps1") {
    return scriptInvocation(target, args);
  }
  return { executable: target, args, shim: false };
}
