const INTERACTIVE = new Set([
  "vi",
  "vim",
  "nvim",
  "nano",
  "emacs",
  "less",
  "more",
  "top",
  "htop",
  "watch",
  "tmux",
  "screen",
  "mc",
  "ranger",
  "fzf",
  "dialog",
  "whiptail",
]);

const SHELLS = new Set(["bash", "zsh", "sh", "fish", "pwsh", "powershell", "cmd", "cmd.exe"]);

function baseName(executable: string): string {
  return (executable.split(/[\\/]/).at(-1) ?? executable).toLowerCase().replace(/\.exe$/, "");
}

function firstToken(command: string): string {
  return (command.trim().split(/\s+/, 1)[0] ?? "").toLowerCase().replace(/^["']|["']$/g, "");
}

/** Reject tools that expect a terminal. They would consume the Turn's pipes. */
export function isInteractiveExecutable(executable: string, args: string[]): boolean {
  const name = baseName(executable);
  if (INTERACTIVE.has(name)) return true;
  if (name === "git") {
    const joined = args.join(" ");
    return /\brebase\s+(-i|--interactive)\b/.test(joined);
  }
  return false;
}

/** Reject a bare interactive shell or a TUI command inside run_shell. */
export function isInteractiveShellCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  const first = firstToken(trimmed);
  if (INTERACTIVE.has(first)) return true;
  if (first === "git" && /\brebase\s+(-i|--interactive)\b/.test(trimmed)) return true;
  if (!SHELLS.has(first)) return false;

  const rest = trimmed.slice(trimmed.indexOf(first) + first.length).trim();
  // `sh -c '...'` and `bash script.sh` are finite commands; a bare shell or a
  // forced-interactive shell is not.
  return rest.length === 0 || /^-i(\s|$)/.test(rest);
}
