import { execFileSync as nodeExecFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

type Options = Parameters<typeof nodeExecFileSync>[2];

function quote(value: string): string {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Playwright specs run on both POSIX and Windows. `execFileSync("pnpm")`
 * cannot launch the Windows .cmd shim directly, and tests only need a tiny
 * command subset; normalize it here instead of in every spec.
 */
export function execFileSync<T extends Buffer | string = string>(
  command: string,
  args: readonly string[],
  options: Options = {},
): T {
  if (command === "mkdir" && args[0] === "-p" && args[1]) {
    mkdirSync(args[1], { recursive: true });
    return "" as T;
  }
  if (process.platform !== "win32" || command !== "pnpm") {
    return nodeExecFileSync(command, args, options) as T;
  }
  const line = ["pnpm", ...args].map(quote).join(" ");
  return nodeExecFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], {
    ...options,
    windowsVerbatimArguments: true,
  }) as T;
}
