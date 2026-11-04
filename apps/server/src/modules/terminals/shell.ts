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
