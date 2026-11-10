const POSIX_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
] as const;

// Windows programs and shell shims need the system and per-user locations that
// cmd.exe/npm/git read. Keep an explicit allowlist so unrelated secrets never
// leak into commands or terminals.
const WINDOWS_KEYS = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "COMSPEC",
  "ComSpec",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
  "TEMP",
  "TMP",
  "TMPDIR",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PSModulePath",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
] as const;

/**
 * Build the deliberately small environment every managed child receives.
 * Callers may add scoped variables (PM2_HOME, TZ, job ids) on top.
 */
export function commandEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const keys = process.platform === "win32" ? WINDOWS_KEYS : POSIX_KEYS;
  const seen = new Set<string>();
  for (const key of keys) {
    // Windows environment names are case-insensitive; keep the first spelling.
    const identity = process.platform === "win32" ? key.toLowerCase() : key;
    if (seen.has(identity)) continue;
    if (source[key] !== undefined) {
      seen.add(identity);
      env[key] = source[key];
    }
  }
  return env;
}

/** Absolute Windows PowerShell 5.1 path, which ships with Windows 10/11. */
export function windowsPowerShell(): string {
  const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  return `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

/** Quote a value as a PowerShell single-quoted literal. */
export function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Encode a PowerShell script without cmd/PowerShell command-line quoting. */
export function powerShellEncodedCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

/** Arguments for a non-interactive PowerShell invocation. */
export function powerShellArguments(script: string, noExit = false): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    ...(noExit ? ["-NoExit"] : []),
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    powerShellEncodedCommand(script),
  ];
}
