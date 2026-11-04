import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";

export async function resolveManualShell(accountShell?: string | null): Promise<string> {
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
const DEV_SHELL_BOOTSTRAP = `trap ':' INT; (exec -- "$@"); exec "$0" -i`;
export function terminalLaunch(shell: string, program?: { executable: string; args: string[] }) {
  return program
    ? {
        executable: "/bin/sh",
        args: ["-i", "-c", DEV_SHELL_BOOTSTRAP, shell, program.executable, ...program.args],
      }
    : { executable: shell, args: ["-i"] };
}
